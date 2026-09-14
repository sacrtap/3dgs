/**
 * ★ C-03: SPZ v1-v4 读取器测试 — 与 writer 量化互逆 + 版本兼容 + zstd 注入
 *
 * 覆盖:
 *   1. writeSpzSoA (v2) → loadGaussiansFromSpzSoA round-trip (数值在量化误差内)
 *   2. v1 布局合成字节读取 (float16 positions + 3B 旋转)
 *   3. v3 布局合成字节读取 (24-bit positions + 4B smallest-three 旋转)
 *   4. v4 NGSP+zstd: TOC 解析 + 流解压 (注入解压器) → 属性值一致
 *   5. 错误路径: magic 校验失败 / 属性体截断 / v4 缺少解压器
 *
 * 测试数据全部为合成数据 (不依赖 gitignore 的 .spz 文件)。
 */

import { describe, it, expect } from 'vitest';
import {
  loadGaussiansFromSpzSoA,
  loadGaussiansFromSpz,
  parseSpzHeader,
  parseLegacyHeader,
  parseNgspHeader,
  decodeLegacyBody,
  SPZ_MAGIC,
} from './spz-reader.js';
import type { GaussianCloudSoA } from './gaussian-loader.js';
import { writeSpzSoA } from './spz-writer.js';
import { toSoA } from './gaussian-loader.js';

const SQRT1_2 = 0.7071067811865476;
const SH_C0 = 0.28209479177387814;

/** 构造确定性 SoA 云 (覆盖 SH degree 0/1) */
function makeSoa(count: number, shDegree: 0 | 1 = 1): GaussianCloudSoA {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / 10;
    positions[i * 3] = (i - count / 2) * 0.25;
    positions[i * 3 + 1] = t * 1.3;
    positions[i * 3 + 2] = Math.cos(t * Math.PI) * 2.1;
    scales[i * 3] = 0.01 + t * 0.02;
    scales[i * 3 + 1] = 0.02 + t * 0.01;
    scales[i * 3 + 2] = 0.005 + t * 0.008;
    // 单位四元数 (w 主导, 保证 v2 xyz 编码可恢复 w)
    rotations[i * 4] = 0.999;
    rotations[i * 4 + 1] = 0.01 + t * 0.001;
    rotations[i * 4 + 2] = -0.02 - t * 0.001;
    rotations[i * 4 + 3] = 0.03 + t * 0.002;
    colors[i * 3] = Math.min(1, Math.max(0, 0.5 + 0.3 * Math.sin(t * Math.PI)));
    colors[i * 3 + 1] = 0.4;
    colors[i * 3 + 2] = Math.min(1, Math.max(0, 0.6 + 0.2 * Math.cos(t * Math.PI)));
    opacities[i] = 0.55 + 0.4 * ((i % 10) / 9);
  }
  let sh: Float32Array | undefined;
  if (shDegree > 0) {
    sh = new Float32Array(count * 9);
    for (let i = 0; i < count * 9; i++) {
      sh[i] = (Math.sin(i * 0.7) * 0.5) / 128; // 落在 5-bit 量化桶范围内
    }
  }
  return {
    count,
    shDegree,
    source: 'test',
    positions,
    scales,
    rotations,
    colors,
    opacities,
    sh,
  };
}

/** tiny zstd 模拟: 压缩 = skippable 帧 + 原始字节; 解压 = 剥帧头 (验证 reader 的 TOC/流切分/尺寸校验逻辑) */
function makeMockZstd() {
  return {
    compress(bytes: Uint8Array): Uint8Array {
      const out = new Uint8Array(8 + bytes.length);
      const view = new DataView(out.buffer);
      view.setUint32(0, 0x184d2a50, true); // skippable frame magic
      view.setUint32(4, bytes.length, true);
      out.set(bytes, 8);
      return out;
    },
    decompress(compressed: Uint8Array, size: number): Uint8Array {
      const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
      expect(view.getUint32(4, true)).toBe(size);
      return compressed.slice(8, 8 + size);
    },
  };
}

/** 手工构建 v4 NGSP 文件 (属性流编码与 writer 一致, 切 6 条流后 mock-zstd 压缩) */
function buildNgspV4(
  soa: GaussianCloudSoA,
  zstd: { compress(b: Uint8Array): Uint8Array },
  shDegree = soa.shDegree,
): Uint8Array {
  const shDim = { 0: 0, 1: 3, 2: 8, 3: 15, 4: 24 }[shDegree] ?? 0;
  const count = soa.count;

  const posSize = count * 9;
  const alphaSize = count;
  const colorSize = count * 3;
  const scaleSize = count * 3;
  const rotSize = count * 4; // v4 → smallest-three
  const shSize = count * shDim * 3;
  const body = new Uint8Array(posSize + alphaSize + colorSize + scaleSize + rotSize + shSize);
  const bv = new DataView(body.buffer);

  // positions: round(x * 4096), int24 LE
  let off = 0;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.round(soa.positions[i * 3 + c] * 4096);
      bv.setUint8(off + c * 3, v & 0xff);
      bv.setUint8(off + c * 3 + 1, (v >> 8) & 0xff);
      bv.setUint8(off + c * 3 + 2, (v >> 16) & 0xff);
    }
    off += 9;
  }
  for (let i = 0; i < count; i++) body[off + i] = Math.round(soa.opacities[i] * 255);
  off += alphaSize;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const v = ((soa.colors[i * 3 + c] - 0.5) / (SH_C0 / 0.15) + 0.5) * 255;
      body[off + i * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  off += colorSize;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const v = (Math.log(Math.max(soa.scales[i * 3 + c], 1e-10)) + 10) * 16;
      body[off + i * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  off += scaleSize;
  for (let i = 0; i < count; i++) {
    packSmallestThree(body, off + i * 4, soa.rotations, i * 4);
  }
  off += rotSize;
  if (shDim > 0 && soa.sh) {
    for (let i = 0; i < count * shDim * 3; i++) {
      let q = Math.round(soa.sh[i] * 128) + 128;
      const bucket = 8; // 5-bit
      q = Math.floor((q + bucket / 2) / bucket) * bucket;
      body[off + i] = Math.max(0, Math.min(255, q));
    }
  }

  // 切 6 条流 (SH 空则省略)
  const streamSizes = [posSize, alphaSize, colorSize, scaleSize, rotSize, shDim === 0 ? 0 : shSize];
  const toc: Array<{ cs: number; us: number }> = [];
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (let s = 0; s < 6; s++) {
    const us = streamSizes[s];
    if (us === 0) continue;
    const compressed = zstd.compress(body.subarray(cursor, cursor + us));
    toc.push({ cs: compressed.length, us });
    chunks.push(compressed);
    cursor += us;
  }

  const headerSize = 32;
  const tocByteOffset = headerSize;
  const tocSize = toc.length * 16;
  const total = tocByteOffset + tocSize + chunks.reduce((a, c) => a + c.length, 0);
  const file = new Uint8Array(total);
  const fv = new DataView(file.buffer);

  fv.setUint32(0, SPZ_MAGIC, true);
  fv.setUint32(4, 4, true); // version 4
  fv.setUint32(8, count, true);
  fv.setUint8(12, shDegree);
  fv.setUint8(13, 12);
  fv.setUint8(14, 1);
  fv.setUint8(15, toc.length);
  fv.setUint32(16, tocByteOffset, true);

  toc.forEach((t, i) => {
    const e = tocByteOffset + i * 16;
    fv.setBigUint64(e, BigInt(t.cs), true);
    fv.setBigUint64(e + 8, BigInt(t.us), true);
  });

  let fCursor = tocByteOffset + tocSize;
  for (const chunk of chunks) {
    file.set(chunk, fCursor);
    fCursor += chunk.length;
  }
  return file;
}

/** smallest-three 打包 (iLargest 最高 2bit, 其余按 i 升序左移 10bit) */
function packSmallestThree(
  out: Uint8Array,
  offset: number,
  rotations: Float32Array,
  i4: number,
): void {
  const q = [rotations[i4], rotations[i4 + 1], rotations[i4 + 2], rotations[i4 + 3]];
  let iLargest = 0;
  for (let i = 1; i < 4; i++) {
    if (Math.abs(q[i]) > Math.abs(q[iLargest])) iLargest = i;
  }
  const negate = q[iLargest] < 0;
  let comp = iLargest;
  for (let i = 0; i < 4; i++) {
    if (i !== iLargest) {
      const negbit = (q[i] < 0 ? 1 : 0) ^ (negate ? 1 : 0);
      const mag = Math.round(((1 << 9) - 1) * (Math.abs(q[i]) / SQRT1_2));
      comp = (comp << 10) | (negbit << 9) | mag;
    }
  }
  out[offset] = comp & 0xff;
  out[offset + 1] = (comp >> 8) & 0xff;
  out[offset + 2] = (comp >> 16) & 0xff;
  out[offset + 3] = (comp >> 24) & 0xff;
}

/** float16 → bytes (LE), 测试构造用 */
function writeFloat16(view: DataView, offset: number, v: number): void {
  const sign = v < 0 ? 0x8000 : 0;
  let a = Math.abs(v);
  let exp = 0;
  let frac = 0;
  if (a >= 6.1e-5 && a < 65504) {
    let e = 0;
    while (a >= 2) {
      a /= 2;
      e++;
    }
    while (a < 1) {
      a *= 2;
      e--;
    }
    exp = e + 15;
    frac = Math.round((a - 1) * 1024);
  } else if (a !== 0) {
    frac = Math.round(a / 6.1e-5);
  }
  view.setUint16(offset, sign | (exp << 10) | frac, true);
}

describe('C-03 SPZ v1-v4 读取器', () => {
  it('round-trip: writeSpzSoA (v2) 产物可被 reader 读取, 属性在量化误差内', async () => {
    const soa = makeSoa(25, 1);
    const spz = await writeSpzSoA(soa);
    const readBack = await loadGaussiansFromSpzSoA(new Uint8Array(spz));

    expect(readBack.count).toBe(25);
    expect(readBack.shDegree).toBe(1);

    // 位置: 24-bit 量化 → 误差 ≤ 1/4096
    for (let i = 0; i < 25 * 3; i++) {
      expect(readBack.positions[i]).toBeCloseTo(soa.positions[i], 3);
    }
    // 不透明度: 8-bit → ≤ 1/255
    for (let i = 0; i < 25; i++) {
      expect(Math.abs(readBack.opacities[i] - soa.opacities[i])).toBeLessThanOrEqual(1 / 255);
    }
    // 颜色: DC 8-bit → ≤ 1/255 × (SH_C0/0.15)
    for (let i = 0; i < 25; i++) {
      const tol = (1 / 255) * (SH_C0 / 0.15);
      expect(Math.abs(readBack.colors[i * 3] - soa.colors[i * 3])).toBeLessThanOrEqual(tol + 1e-6);
      expect(Math.abs(readBack.colors[i * 3 + 1] - soa.colors[i * 3 + 1])).toBeLessThanOrEqual(
        tol + 1e-6,
      );
    }
    // 缩放: log 编码 8-bit → log 域误差 ≤ 1/16
    for (let i = 0; i < 25; i++) {
      expect(readBack.scales[i * 3]).toBeGreaterThan(0);
      const logErr = Math.abs(Math.log(readBack.scales[i * 3]) - Math.log(soa.scales[i * 3]));
      expect(logErr).toBeLessThanOrEqual(1 / 16 + 1e-6);
    }
    // 旋转: 单位四元数
    for (let i = 0; i < 25; i++) {
      const i4 = i * 4;
      const len = Math.sqrt(
        readBack.rotations[i4] ** 2 +
          readBack.rotations[i4 + 1] ** 2 +
          readBack.rotations[i4 + 2] ** 2 +
          readBack.rotations[i4 + 3] ** 2,
      );
      expect(len).toBeCloseTo(1, 3);
    }
    // SH: 5-bit 量化 → 误差 ≤ 4/128 + 1/128
    for (let i = 0; i < 25 * 9; i++) {
      expect(Math.abs(readBack.sh![i] - soa.sh![i])).toBeLessThanOrEqual(5 / 128);
    }
  });

  it('AoS 入口 loadGaussiansFromSpz 与 SoA 等价', async () => {
    const soa = makeSoa(15, 1);
    const spz = await writeSpzSoA(soa);
    const aos = await loadGaussiansFromSpz(new Uint8Array(spz));
    const soaRead = await loadGaussiansFromSpzSoA(new Uint8Array(spz));
    expect(aos.splats).toHaveLength(15);
    expect(aos.splats[0].x).toBeCloseTo(soaRead.positions[0], 3);
    expect(aos.splats[0].sh).toHaveLength(9);
  });

  it('v1 布局: float16 positions + 3B 旋转可读', () => {
    const count = 3;
    const body = new Uint8Array(count * 6 + count * 1 + count * 3 + count * 3 + count * 3);
    const view = new DataView(body.buffer);

    let off = 0;
    writeFloat16(view, off, 1.5);
    writeFloat16(view, off + 2, -2.25);
    writeFloat16(view, off + 4, 0.5);
    off += 6;
    writeFloat16(view, off, 10);
    writeFloat16(view, off + 2, -0.5);
    writeFloat16(view, off + 4, 3.75);
    off += 6;
    writeFloat16(view, off, 0.001);
    writeFloat16(view, off + 2, 0.002);
    writeFloat16(view, off + 4, 0.003);
    off += 6;

    // alphas
    body[off++] = 128;
    body[off++] = 64;
    body[off++] = 255;
    // colors
    body[off++] = 0;
    body[off++] = 128;
    body[off++] = 255;
    body[off++] = 64;
    body[off++] = 64;
    body[off++] = 200;
    body[off++] = 128;
    body[off++] = 128;
    body[off++] = 128;
    // scales (log+10)*16 = 160 → scale = 1
    body[off++] = 160;
    body[off++] = 160;
    body[off++] = 160;
    body[off++] = 176;
    body[off++] = 176;
    body[off++] = 160;
    body[off++] = 160;
    body[off++] = 176;
    body[off++] = 176;
    // rotations (0,0,0 → w=1)
    body[off++] = 128;
    body[off++] = 128;
    body[off++] = 128;
    body[off++] = 156;
    body[off++] = 128;
    body[off++] = 128;
    body[off++] = 128;
    body[off++] = 156;
    body[off++] = 128;

    const result = decodeLegacyBody(body, {
      numPoints: 3,
      shDegree: 0,
      fractionalBits: 12,
      version: 1,
    });

    expect(result.positions[0]).toBeCloseTo(1.5, 4);
    expect(result.positions[1]).toBeCloseTo(-2.25, 4);
    expect(result.positions[2]).toBeCloseTo(0.5, 4);
    expect(result.positions[3]).toBeCloseTo(10, 3);
    expect(result.positions[4]).toBeCloseTo(-0.5, 4);
    expect(result.positions[5]).toBeCloseTo(3.75, 3);
    expect(result.opacities[0]).toBeCloseTo(128 / 255, 3);
    expect(result.rotations[0 * 4 + 3]).toBeCloseTo(1, 3); // w=1
  });

  it('v3 布局: 4B smallest-three 旋转解码为近似单位四元数', () => {
    const count = 1;
    const body = new Uint8Array(count * 9 + count * 1 + count * 3 + count * 3 + count * 4);
    const view = new DataView(body.buffer);
    // positions (0,0,0)
    for (let i = 0; i < 9; i++) view.setUint8(i, 0);
    let off = 9;
    body[off++] = 128; // alpha
    body[off++] = 128;
    body[off++] = 128;
    body[off++] = 128; // color
    body[off++] = 160;
    body[off++] = 160;
    body[off++] = 160; // scale → 1
    // rotations: 等分量四元数 (0.5, 0.5, 0.5, 0.5) → iLargest=0, 全正
    const q = [0.5, 0.5, 0.5, 0.5];
    let iLargest = 0;
    for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[iLargest])) iLargest = i;
    let comp = iLargest;
    for (let i = 0; i < 4; i++) {
      if (i !== iLargest) {
        const mag = Math.round(511 * (Math.abs(q[i]) / SQRT1_2));
        comp = (comp << 10) | mag;
      }
    }
    view.setUint32(off, comp, true);

    const result = decodeLegacyBody(body, {
      numPoints: 1,
      shDegree: 0,
      fractionalBits: 12,
      version: 3,
    });
    const len = Math.sqrt(
      result.rotations[0] ** 2 +
        result.rotations[1] ** 2 +
        result.rotations[2] ** 2 +
        result.rotations[3] ** 2,
    );
    expect(len).toBeCloseTo(1, 3);
    expect(result.rotations[0]).toBeGreaterThan(0); // iLargest 为正
    expect(result.rotations[1]).toBeGreaterThan(0);
  });

  it('parseSpzHeader 识别 gzip (v2) 与 NGSP (v4)', async () => {
    const soa = makeSoa(5, 1);
    const spz = await writeSpzSoA(soa);
    const header = await parseSpzHeader(new Uint8Array(spz));
    expect(header.container).toBe('gzip');
    expect(header.version).toBe(2);
    expect(header.numPoints).toBe(5);
    expect(header.shDegree).toBe(1);
    expect(header.antialiased).toBe(true);

    const zstd = makeMockZstd();
    const ngsp = buildNgspV4(makeSoa(8, 1), zstd);
    const ngspHeader = parseNgspHeader(ngsp);
    expect(ngspHeader.container).toBe('ngsp');
    expect(ngspHeader.version).toBe(4);
    expect(ngspHeader.numStreams).toBe(6);
    expect(ngspHeader.tocByteOffset).toBe(32);
  });

  it('v4 NGSP: TOC 解析 + 流解压 → 属性与合成字节一致', async () => {
    const zstd = makeMockZstd();
    const soa = makeSoa(12, 1);
    const ngsp = buildNgspV4(soa, zstd);

    const readBack = await loadGaussiansFromSpzSoA(ngsp, {
      zstdDecompress: zstd.decompress,
    });
    expect(readBack.count).toBe(12);
    expect(readBack.shDegree).toBe(1);

    for (let i = 0; i < 12 * 3; i++) {
      expect(readBack.positions[i]).toBeCloseTo(soa.positions[i], 3);
    }
    for (let i = 0; i < 12; i++) {
      expect(Math.abs(readBack.opacities[i] - soa.opacities[i])).toBeLessThanOrEqual(1 / 255);
    }
    const logErr = Math.abs(Math.log(readBack.scales[0]) - Math.log(soa.scales[0]));
    expect(logErr).toBeLessThanOrEqual(1 / 16);
    for (let i = 0; i < 12 * 9; i++) {
      expect(Math.abs(readBack.sh![i] - soa.sh![i])).toBeLessThanOrEqual(5 / 128);
    }
    for (let i = 0; i < 12; i++) {
      const i4 = i * 4;
      const len = Math.sqrt(
        readBack.rotations[i4] ** 2 +
          readBack.rotations[i4 + 1] ** 2 +
          readBack.rotations[i4 + 2] ** 2 +
          readBack.rotations[i4 + 3] ** 2,
      );
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it('v4 无 SH 时 SH 流省略 (numStreams=5)', async () => {
    const zstd = makeMockZstd();
    const soa = makeSoa(6, 0);
    const ngsp = buildNgspV4(soa, zstd, 0);
    const header = parseNgspHeader(ngsp);
    expect(header.numStreams).toBe(5);

    const readBack = await loadGaussiansFromSpzSoA(ngsp, {
      zstdDecompress: zstd.decompress,
    });
    expect(readBack.sh).toBeUndefined();
    expect(readBack.count).toBe(6);
  });

  it('错误路径: v4 无解压器 → 明确报错', async () => {
    const zstd = makeMockZstd();
    const ngsp = buildNgspV4(makeSoa(4, 0), zstd, 0);
    await expect(loadGaussiansFromSpzSoA(ngsp)).rejects.toThrow(/zstdDecompress|C-11/);
  });

  it('错误路径: legacy magic 校验失败', async () => {
    const soa = makeSoa(3, 0);
    const spz = await writeSpzSoA(soa);
    // gzip 字节直接解析 → magic 失败
    expect(() => parseLegacyHeader(new Uint8Array(spz))).toThrow(/magic/);
  });

  it('错误路径: 属性体截断', () => {
    const body = new Uint8Array(10);
    expect(() =>
      decodeLegacyBody(body, { numPoints: 100, shDegree: 1, fractionalBits: 12, version: 2 }),
    ).toThrow(/长度不足/);
  });

  it('round-trip 等价性: SoA 直读与 AoS→toSoA 数据一致', async () => {
    const cloud = makeSoa(20, 1);
    const spz = await writeSpzSoA(cloud);
    const direct = await loadGaussiansFromSpzSoA(new Uint8Array(spz));
    expect(direct.positions.length).toBe(cloud.positions.length);
    expect(direct.shDegree).toBe(cloud.shDegree);
    const viaAos = toSoA(await loadGaussiansFromSpz(new Uint8Array(spz)));
    expect(direct.positions).toEqual(viaAos.positions);
    expect(direct.opacities).toEqual(viaAos.opacities);
  });
});
