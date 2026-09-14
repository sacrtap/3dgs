/**
 * 压缩 PLY 写入器 — SuperSplat 兼容打包格式
 *
 * 与 GaussianSplats3D / SuperSplat 导出的压缩 PLY 布局一致:
 *   - element vertex N: 4 × uint32 (packed_position/rotation/scale/color)
 *   - element chunk M: 18 × float32 范围属性 (每 256 顶点一个 chunk)
 *
 * 打包编码 (与 loader 端 loadSuperSplatFastPath 互为逆运算):
 *   - packed_position: x 11bit / y 10bit / z 11bit, 按 chunk 位置范围归一化
 *   - packed_rotation: smallest-three 四元数 (r0/r1/r2 10bit + order 2bit)
 *   - packed_scale: x 11bit / y 10bit / z 11bit, log 空间, 按 chunk 缩放范围归一化
 *   - packed_color: RGBA 8bit×4 (R 最高 8 位), RGB 按 chunk 颜色范围归一化, A = opacity / 255
 *
 * [来源: SuperSplat 打包格式 — node_modules/@sparkjsdev/spark/dist/spark.module.js decodeSuperSplat]
 * [来源: GaussianSplats3D CompressedPlyLoader — github.com/mkkellogg/GaussianSplats3D]
 */

import type { GaussianCloud, GaussianCloudSoA } from './gaussian-loader.js';
import { toSoA } from './gaussian-loader.js';

/** 每个 chunk 的顶点数 (与读取端 (i >>> 8) 对齐) */
export const SS_PLY_VERTICES_PER_CHUNK = 256;

/** chunk element 的 18 个范围属性 (顺序无关, 按名写入) */
const SS_CHUNK_PROPS = [
  'min_x',
  'min_y',
  'min_z',
  'max_x',
  'max_y',
  'max_z',
  'min_scale_x',
  'min_scale_y',
  'min_scale_z',
  'max_scale_x',
  'max_scale_y',
  'max_scale_z',
  'min_r',
  'min_g',
  'min_b',
  'max_r',
  'max_g',
  'max_b',
] as const;

const SQRT2 = Math.sqrt(2);

/** 写入选项 */
export interface CompressedPlyWriterOptions {
  /** 数据来源描述 */
  source?: string;
}

/**
 * 将 GaussianCloud 写为 SuperSplat 兼容的压缩 PLY
 *
 * @param cloud 高斯核集合
 * @param options 写入选项
 * @returns 压缩 PLY 字节
 */
export function writeCompressedPly(
  cloud: GaussianCloud,
  options: CompressedPlyWriterOptions = {},
): ArrayBuffer {
  return writeCompressedPlySoA(toSoA(cloud), options);
}

/**
 * ★ C-05: 将 GaussianCloudSoA 写为 SuperSplat 兼容的压缩 PLY
 *
 * 与 loadSuperSplatFastPath 的解码完全互逆 (已用 round-trip 测试验证)。
 */
export function writeCompressedPlySoA(
  soa: GaussianCloudSoA,
  options: CompressedPlyWriterOptions = {},
): ArrayBuffer {
  const count = soa.count;
  const numChunks = count === 0 ? 0 : Math.ceil(count / SS_PLY_VERTICES_PER_CHUNK);

  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    // ★ security: source 可能含换行, 注入 PLY header 会截断/产生非法行 — 替换为空格
    `comment ${String(options.source ?? '3dgs-convert').replace(/[\r\n]+/g, ' ')}\n` +
    `element vertex ${count}\n` +
    'property uint packed_position\n' +
    'property uint packed_rotation\n' +
    'property uint packed_scale\n' +
    'property uint packed_color\n' +
    `element chunk ${numChunks}\n` +
    SS_CHUNK_PROPS.map((p) => `property float ${p}`).join('\n') +
    '\nend_header\n';
  const headerBytes = new TextEncoder().encode(header);

  const vertexStride = 16;
  const chunkStride = SS_CHUNK_PROPS.length * 4;
  const totalSize = headerBytes.length + count * vertexStride + numChunks * chunkStride;
  const buffer = new ArrayBuffer(totalSize);
  const u8 = new Uint8Array(buffer);
  u8.set(headerBytes, 0);
  const view = new DataView(buffer);
  const chunkBase = headerBytes.length + count * vertexStride;

  // ── 逐 chunk: 先算范围, 再打包顶点 ──
  for (let c = 0; c < numChunks; c++) {
    const start = c * SS_PLY_VERTICES_PER_CHUNK;
    const end = Math.min(start + SS_PLY_VERTICES_PER_CHUNK, count);

    // 1. chunk 范围
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    let minSX = Infinity,
      minSY = Infinity,
      minSZ = Infinity;
    let maxSX = -Infinity,
      maxSY = -Infinity,
      maxSZ = -Infinity;
    let minR = Infinity,
      minG = Infinity,
      minB = Infinity;
    let maxR = -Infinity,
      maxG = -Infinity,
      maxB = -Infinity;

    for (let i = start; i < end; i++) {
      const i3 = i * 3;
      const x = soa.positions[i3];
      const y = soa.positions[i3 + 1];
      const z = soa.positions[i3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;

      const lx = Math.log(Math.max(soa.scales[i3], 1e-10));
      const ly = Math.log(Math.max(soa.scales[i3 + 1], 1e-10));
      const lz = Math.log(Math.max(soa.scales[i3 + 2], 1e-10));
      if (lx < minSX) minSX = lx;
      if (ly < minSY) minSY = ly;
      if (lz < minSZ) minSZ = lz;
      if (lx > maxSX) maxSX = lx;
      if (ly > maxSY) maxSY = ly;
      if (lz > maxSZ) maxSZ = lz;

      const r = soa.colors[i3];
      const g = soa.colors[i3 + 1];
      const b = soa.colors[i3 + 2];
      if (r < minR) minR = r;
      if (g < minG) minG = g;
      if (b < minB) minB = b;
      if (r > maxR) maxR = r;
      if (g > maxG) maxG = g;
      if (b > maxB) maxB = b;
    }
    // 单点 chunk 避免除零
    if (minX === maxX) maxX = minX + 1e-6;
    if (minY === maxY) maxY = minY + 1e-6;
    if (minZ === maxZ) maxZ = minZ + 1e-6;
    if (minSX === maxSX) maxSX = minSX + 1e-6;
    if (minSY === maxSY) maxSY = minSY + 1e-6;
    if (minSZ === maxSZ) maxSZ = minSZ + 1e-6;
    if (minR === maxR) maxR = minR + 1e-6;
    if (minG === maxG) maxG = minG + 1e-6;
    if (minB === maxB) maxB = minB + 1e-6;

    // 2. chunk element 范围 (float32)
    const cb = chunkBase + c * chunkStride;
    const set = (name: string, value: number) => {
      const idx = SS_CHUNK_PROPS.indexOf(name as (typeof SS_CHUNK_PROPS)[number]);
      // ★ 防御: 属性名不在 SS_CHUNK_PROPS 时静默跳过, 避免 idx=-1 时写越界
      if (idx === -1) return;
      view.setFloat32(cb + idx * 4, value, true);
    };
    set('min_x', minX);
    set('min_y', minY);
    set('min_z', minZ);
    set('max_x', maxX);
    set('max_y', maxY);
    set('max_z', maxZ);
    set('min_scale_x', minSX);
    set('min_scale_y', minSY);
    set('min_scale_z', minSZ);
    set('max_scale_x', maxSX);
    set('max_scale_y', maxSY);
    set('max_scale_z', maxSZ);
    set('min_r', minR);
    set('min_g', minG);
    set('min_b', minB);
    set('max_r', maxR);
    set('max_g', maxG);
    set('max_b', maxB);

    // 3. 顶点打包
    for (let i = start; i < end; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      const row = headerBytes.length + i * vertexStride;

      // packed_position: x 11bit / y 10bit / z 11bit
      const px = quantize11(soa.positions[i3], minX, maxX);
      const py = quantize10(soa.positions[i3 + 1], minY, maxY);
      const pz = quantize11(soa.positions[i3 + 2], minZ, maxZ);
      view.setUint32(row, (px << 21) | (py << 11) | pz, true);

      // packed_rotation: smallest-three (order 指示最大分量)
      const q = [
        soa.rotations[i4],
        soa.rotations[i4 + 1],
        soa.rotations[i4 + 2],
        soa.rotations[i4 + 3],
      ];
      view.setUint32(row + 4, packRotationSmallestThree(q), true);

      // packed_scale: log 空间 x 11bit / y 10bit / z 11bit
      const sx = quantize11(Math.log(Math.max(soa.scales[i3], 1e-10)), minSX, maxSX);
      const sy = quantize10(Math.log(Math.max(soa.scales[i3 + 1], 1e-10)), minSY, maxSY);
      const sz = quantize11(Math.log(Math.max(soa.scales[i3 + 2], 1e-10)), minSZ, maxSZ);
      view.setUint32(row + 8, (sx << 21) | (sy << 11) | sz, true);

      // packed_color: RGBA (R 最高 8 位), RGB 按范围, A = opacity/255
      const cr = quantize8(soa.colors[i3], minR, maxR);
      const cg = quantize8(soa.colors[i3 + 1], minG, maxG);
      const cb = quantize8(soa.colors[i3 + 2], minB, maxB);
      const ca = Math.max(0, Math.min(255, Math.round(soa.opacities[i] * 255)));
      view.setUint32(row + 12, (cr << 24) | (cg << 16) | (cb << 8) | ca, true);
    }
  }

  return buffer;
}

// ── 打包辅助 ─────────────────────────────────────────────

/** 位置/缩放范围 → 11bit 整数 (读取端除以 2047) */
function quantize11(v: number, min: number, max: number): number {
  const t = (v - min) / (max - min);
  return Math.max(0, Math.min(2047, Math.round(t * 2047)));
}

/** 10bit 整数 (读取端除以 1023) */
function quantize10(v: number, min: number, max: number): number {
  const t = (v - min) / (max - min);
  return Math.max(0, Math.min(1023, Math.round(t * 1023)));
}

/** 8bit 整数 */
function quantize8(v: number, min: number, max: number): number {
  const t = (v - min) / (max - min);
  return Math.max(0, Math.min(255, Math.round(t * 255)));
}

/**
 * smallest-three 四元数打包 (与读取端逆运算)
 *
 * 读取端映射 (rOrder):
 *   order 0: (X,Y,Z,W) = (r0, r1, r2, rr)
 *   order 1: (X,Y,Z,W) = (rr, r1, r2, r0)
 *   order 2: (X,Y,Z,W) = (r1, rr, r2, r0)
 *   order 3: (X,Y,Z,W) = (r1, r2, rr, r0)
 * 其中 r0 存 bit 20-29, r1 存 bit 10-19, r2 存 bit 0-9, rr 由单位性推导。
 *
 * 写入端: 找出最大分量:
 *   |W| 最大 → order 0, r0=X, r1=Y, r2=Z
 *   |X| 最大 → order 1, r0=W, r1=Y, r2=Z
 *   |Y| 最大 → order 2, r0=W, r1=X, r2=Z
 *   |Z| 最大 → order 3, r0=W, r1=X, r2=Y
 */
function packRotationSmallestThree(q: number[]): number {
  const [w, x, y, z] = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
  const len = Math.sqrt(w * w + x * x + y * y + z * z) || 1;
  const nw = w / len;
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;
  // 保证最大分量为正
  const abs = [Math.abs(nw), Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  let order = 0;
  for (let i = 1; i < 4; i++) {
    if (abs[i] > abs[order]) order = i;
  }
  const negate = [nw, nx, ny, nz][order] < 0;
  const s = negate ? -1 : 1;
  const a = [nw * s, nx * s, ny * s, nz * s];

  let r0: number;
  let r1: number;
  let r2: number;
  switch (order) {
    case 0: // W 最大
      r0 = a[1];
      r1 = a[2];
      r2 = a[3]; // X, Y, Z
      break;
    case 1: // X 最大
      r0 = a[0];
      r1 = a[2];
      r2 = a[3]; // W, Y, Z
      break;
    case 2: // Y 最大
      r0 = a[0];
      r1 = a[1];
      r2 = a[3]; // W, X, Z
      break;
    default: // Z 最大
      r0 = a[0];
      r1 = a[1];
      r2 = a[2]; // W, X, Y
      break;
  }

  // 编码到 10bit: 读取端 (v/1023 - 0.5) * SQRT2 → v = (x / SQRT2 + 0.5) * 1023
  const enc = (v: number): number => {
    const t = v / SQRT2 + 0.5;
    return Math.max(0, Math.min(1023, Math.round(t * 1023)));
  };
  return (order << 30) | (enc(r0) << 20) | (enc(r1) << 10) | enc(r2);
}
