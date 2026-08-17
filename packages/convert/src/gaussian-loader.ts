/**
 * Gaussian 数据模型 — 将任意 PLY 归一化为 3DGS 高斯属性
 *
 * 支持:
 *   - 标准 3DGS PLY (含 opacity, scale, rotation, SH 系数)
 *   - SuperSplat 打包 PLY (packed_position/rotation/scale/color + chunk 元数据)
 *   - 简单点云 PLY (仅 position + color) — 自动生成默认高斯属性
 *
 * [来源: 3DGS 原始论文 — Kerbl et al. 2023]
 * [来源: SPZ 格式 — github.com/nianticlabs/spz]
 * [来源: Spark 源码 — node_modules/@sparkjsdev/spark/dist/spark.module.js SpzWriter]
 * [来源: SuperSplat 打包格式 — node_modules/@sparkjsdev/spark/dist/spark.module.js decodeSuperSplat]
 */

import { parsePly } from './ply-parser.js';
import { parsePlyHeader, tryFastPathParsePly, buildCloudFromFastPath } from './ply-parser.js';

/** 单个高斯核的完整属性 (归一化后) */
export interface GaussianSplat {
  // 位置
  x: number;
  y: number;
  z: number;

  // 缩放 (原始值, 非 log 空间)
  scaleX: number;
  scaleY: number;
  scaleZ: number;

  // 旋转四元数 (w, x, y, z)
  rotW: number;
  rotX: number;
  rotY: number;
  rotZ: number;

  // 颜色 (0-1 范围, SH DC 分量)
  colorR: number;  // 0-1
  colorG: number;
  colorB: number;

  // 不透明度 (0-1, sigmoid 后)
  opacity: number;

  // 球谐系数 (可选, 展平数组)
  // SH degree 1: 9 个系数 (3 channels × 3 coefficients)
  // SH degree 2: 24 个系数
  // SH degree 3: 45 个系数
  sh?: Float32Array;
  shDegree: number;
}

/** 高斯核集合 */
export interface GaussianCloud {
  splats: GaussianSplat[];
  shDegree: number;
  /** 原始 PLY 的顶点数 */
  vertexCount: number;
  /** 来源信息 */
  source: string;
}

/** SH C0 常数 (球谐函数第 0 阶) */
export const SH_C0 = 0.28209479177387814;

/** SH 颜色缩放常数 (SPZ 格式使用) */
export const SPZ_COLOR_SCALE = 0.15;

/**
 * 从 PLY 数据加载并归一化为 GaussianCloud
 *
 * 自动检测 PLY 属性:
 *   - 标准 3DGS PLY: 提取 opacity, scale, rotation, SH 系数
 *   - 简单点云: 生成默认高斯属性 (opacity=1, 小 scale, identity rotation)
 *
 * @param buffer PLY 文件的 ArrayBuffer
 * @param options 加载选项
 */
export interface LoadGaussianOptions {
  /** SH 阶数 (0-3), 默认自动检测 */
  shDegree?: number;
  /** 简单点云的默认缩放值 (默认 0.01) */
  defaultScale?: number;
  /** 来源描述 */
  source?: string;
}

export function loadGaussiansFromPly(
  buffer: ArrayBuffer,
  options: LoadGaussianOptions = {},
): GaussianCloud {
  const { defaultScale = 0.01, source = 'unknown' } = options;

  // ★ M2: 尝试快路径解析 (二进制 PLY → TypedArray, 内存-50%, 速度+2x)
  // 若不支持快路径 (ASCII 格式 / list 属性), 回退到标准解析
  try {
    const headerResult = parsePlyHeader(buffer);
    const fastData = tryFastPathParsePly(buffer, headerResult.header, headerResult.headerEnd);
    if (fastData) {
      // 检查是否是 SuperSplat 打包格式 (快路径不支持)
      const vertexEl = headerResult.header.elements.find((e) => e.name === 'vertex');
      const firstPropNames = vertexEl?.properties.map((p) => p.name) ?? [];
      const isSuperSplat = firstPropNames.includes('packed_position');
      if (!isSuperSplat) {
        return buildCloudFromFastPath(fastData, { defaultScale, source });
      }
    }
  } catch {
    // 快路径失败, 回退到标准解析
  }

  const ply = parsePly(buffer);

  // 找到 vertex element
  const vertexData = ply.data.get('vertex');
  if (!vertexData || !Array.isArray(vertexData)) {
    throw new Error('PLY 文件缺少 vertex element');
  }

  const vertices = vertexData as Record<string, number | number[]>[];
  const firstRow = vertices[0];

  // 检测 PLY 类型
  const has3dgsProps = 'opacity' in firstRow && 'scale_0' in firstRow && 'rot_0' in firstRow;
  const hasColor = 'red' in firstRow && 'green' in firstRow && 'blue' in firstRow;
  const hasSHdc = 'f_dc_0' in firstRow;
  const hasSHrest = 'f_rest_0' in firstRow;

  // ★ 检测 SuperSplat 打包格式
  // [来源: Spark 源码 — decodeSuperSplat, spark.module.js:13167]
  const isSuperSplat =
    'packed_position' in firstRow &&
    'packed_rotation' in firstRow &&
    'packed_scale' in firstRow &&
    'packed_color' in firstRow;

  if (isSuperSplat) {
    return loadSuperSplatPly(ply, vertices, source);
  }

  // 确定 SH 阶数
  let shDegree = options.shDegree ?? 0;
  if (shDegree === 0 && hasSHrest) {
    // 自动检测 SH 阶数
    let restCount = 0;
    for (const key of Object.keys(firstRow)) {
      if (key.startsWith('f_rest_')) restCount++;
    }
    // SH degree 1: 9 rest coefficients (3 per channel × 3)
    // SH degree 2: 24 rest coefficients
    // SH degree 3: 45 rest coefficients
    if (restCount >= 45) shDegree = 3;
    else if (restCount >= 24) shDegree = 2;
    else if (restCount >= 9) shDegree = 1;
  } else if (shDegree === 0 && hasSHdc) {
    shDegree = 0; // 只有 DC, 无高阶 SH
  }

  // 计算每个 SH degree 的系数数 (per channel)
  // SH degree N 有 (N+1)² - 1 = N*(N+2) 个非 DC 系数 per channel
  // [来源: SPZ 源码 — dimForDegree(degree) = {1:3, 2:8, 3:15}]
  const shCoeffsPerChannel = shDegree === 0 ? 0 : shDegree * (shDegree + 2);
  // 总 SH 系数数 (3 channels)
  const totalShCoeffs = shCoeffsPerChannel * 3;

  const splats: GaussianSplat[] = [];

  for (let i = 0; i < vertices.length; i++) {
    const row = vertices[i];

    // ── 位置 ──
    const x = Number(row.x) || 0;
    const y = Number(row.y) || 0;
    const z = Number(row.z) || 0;

    // ── 缩放 ──
    let scaleX: number, scaleY: number, scaleZ: number;
    if (has3dgsProps) {
      // 标准 3DGS: scale 是 log 空间, 需要 exp
      scaleX = Math.exp(Number(row.scale_0) || 0);
      scaleY = Math.exp(Number(row.scale_1) || 0);
      scaleZ = Math.exp(Number(row.scale_2) || 0);
    } else {
      // 简单点云: 使用默认缩放
      scaleX = scaleY = scaleZ = defaultScale;
    }

    // ── 旋转 ──
    let rotW: number, rotX: number, rotY: number, rotZ: number;
    if (has3dgsProps) {
      rotW = Number(row.rot_0) || 1;
      rotX = Number(row.rot_1) || 0;
      rotY = Number(row.rot_2) || 0;
      rotZ = Number(row.rot_3) || 0;
    } else {
      // 简单点云: identity quaternion
      rotW = 1; rotX = 0; rotY = 0; rotZ = 0;
    }

    // ── 颜色 ──
    let colorR: number, colorG: number, colorB: number;
    if (hasSHdc) {
      // 标准 3DGS: f_dc → color = SH_C0 * f_dc + 0.5
      colorR = SH_C0 * Number(row.f_dc_0) + 0.5;
      colorG = SH_C0 * Number(row.f_dc_1) + 0.5;
      colorB = SH_C0 * Number(row.f_dc_2) + 0.5;
    } else if (hasColor) {
      // 简单点云: RGB 0-255 → 0-1
      colorR = Number(row.red) / 255;
      colorG = Number(row.green) / 255;
      colorB = Number(row.blue) / 255;
    } else {
      colorR = 0.8; colorG = 0.8; colorB = 0.8; // 默认灰色
    }

    // ── 不透明度 ──
    let opacity: number;
    if (has3dgsProps) {
      // 标准 3DGS: opacity 是 sigmoid 前的值, 需要 sigmoid
      const rawOpacity = Number(row.opacity) || 0;
      opacity = 1 / (1 + Math.exp(-rawOpacity));
    } else {
      opacity = 1.0; // 完全不透明
    }

    // ── SH 系数 ──
    let sh: Float32Array | undefined;
    if (shDegree > 0 && hasSHrest) {
      sh = new Float32Array(totalShCoeffs);
      for (let j = 0; j < totalShCoeffs; j++) {
        sh[j] = Number(row[`f_rest_${j}`]) || 0;
      }
    }

    splats.push({
      x, y, z,
      scaleX, scaleY, scaleZ,
      rotW, rotX, rotY, rotZ,
      colorR: clamp01(colorR),
      colorG: clamp01(colorG),
      colorB: clamp01(colorB),
      opacity: clamp01(opacity),
      sh,
      shDegree,
    });
  }

  return {
    splats,
    shDegree,
    vertexCount: vertices.length,
    source,
  };
}

// ─── SuperSplat 打包格式支持 ───────────────────────────────

/**
 * SuperSplat 打包 PLY 的 chunk 元数据
 */
interface SuperSplatChunk {
  min_x: number; min_y: number; min_z: number;
  max_x: number; max_y: number; max_z: number;
  min_scale_x: number; min_scale_y: number; min_scale_z: number;
  max_scale_x: number; max_scale_y: number; max_scale_z: number;
  min_r: number; min_g: number; min_b: number;
  max_r: number; max_g: number; max_b: number;
}

const SQRT2 = Math.sqrt(2);

/**
 * 从 SuperSplat 打包 PLY 加载 GaussianCloud
 *
 * SuperSplat 格式使用 chunk 分块量化:
 *   - 每 256 个顶点为一个 chunk, chunk 存储各属性的 min/max 范围
 *   - packed_position (uint32): x=11bit(21-31), y=10bit(11-20), z=11bit(0-10)
 *   - packed_rotation (uint32): r0=10bit(20-29), r1=10bit(10-19), r2=10bit(0-9), order=2bit(30-31)
 *   - packed_scale (uint32): 同 position 布局, 值在 log 空间
 *   - packed_color (uint32): r=8bit(24-31), g=8bit(16-23), b=8bit(8-15), a=8bit(0-7)
 *
 * [来源: Spark 源码 — decodeSuperSplat, spark.module.js:13167-13260]
 */
function loadSuperSplatPly(
  ply: { data: Map<string, Record<string, number | number[]>[]> },
  vertices: Record<string, number | number[]>[],
  source: string,
): GaussianCloud {
  // 读取 chunk 元数据
  const chunkData = ply.data.get('chunk');
  if (!chunkData) {
    throw new Error('SuperSplat PLY 缺少 chunk element');
  }

  const ssChunks: SuperSplatChunk[] = chunkData.map((row) => ({
    min_x: Number(row.min_x), min_y: Number(row.min_y), min_z: Number(row.min_z),
    max_x: Number(row.max_x), max_y: Number(row.max_y), max_z: Number(row.max_z),
    min_scale_x: Number(row.min_scale_x), min_scale_y: Number(row.min_scale_y), min_scale_z: Number(row.min_scale_z),
    max_scale_x: Number(row.max_scale_x), max_scale_y: Number(row.max_scale_y), max_scale_z: Number(row.max_scale_z),
    min_r: Number(row.min_r), min_g: Number(row.min_g), min_b: Number(row.min_b),
    max_r: Number(row.max_r), max_g: Number(row.max_g), max_b: Number(row.max_b),
  }));

  const splats: GaussianSplat[] = [];

  for (let i = 0; i < vertices.length; i++) {
    const row = vertices[i];

    // chunk 索引 = vertex 索引 >>> 8 (每 256 顶点一个 chunk)
    const chunk = ssChunks[i >>> 8];
    if (!chunk) {
      throw new Error(`SuperSplat PLY: 顶点 ${i} 缺少 chunk (index >>> 8 = ${i >>> 8})`);
    }

    const packed_position = Number(row.packed_position) >>> 0; // 确保无符号 32 位
    const packed_rotation = Number(row.packed_rotation) >>> 0;
    const packed_scale = Number(row.packed_scale) >>> 0;
    const packed_color = Number(row.packed_color) >>> 0;

    // ── 位置解包 ──
    // x: bits 21-31 (11 bits, 0-2047), y: bits 11-20 (10 bits, 0-1023), z: bits 0-10 (11 bits, 0-2047)
    const x = ((packed_position >>> 21) & 2047) / 2047 * (chunk.max_x - chunk.min_x) + chunk.min_x;
    const y = ((packed_position >>> 11) & 1023) / 1023 * (chunk.max_y - chunk.min_y) + chunk.min_y;
    const z = (packed_position & 2047) / 2047 * (chunk.max_z - chunk.min_z) + chunk.min_z;

    // ── 旋转解包 (smallest-three 编码) ──
    // r0: bits 20-29, r1: bits 10-19, r2: bits 0-9, order: bits 30-31
    const r0 = (((packed_rotation >>> 20) & 1023) / 1023 - 0.5) * SQRT2;
    const r1 = (((packed_rotation >>> 10) & 1023) / 1023 - 0.5) * SQRT2;
    const r2 = ((packed_rotation & 1023) / 1023 - 0.5) * SQRT2;
    const rr = Math.sqrt(Math.max(0, 1 - r0 * r0 - r1 * r1 - r2 * r2));
    const rOrder = packed_rotation >>> 30;

    // 根据 rOrder 确定四元数分量顺序
    const rotX = rOrder === 0 ? r0 : rOrder === 1 ? rr : r1;
    const rotY = rOrder <= 1 ? r1 : rOrder === 2 ? rr : r2;
    const rotZ = rOrder <= 2 ? r2 : rr;
    const rotW = rOrder === 0 ? rr : r0;

    // ── 缩放解包 (log 空间) ──
    const scaleX = Math.exp(
      ((packed_scale >>> 21) & 2047) / 2047 * (chunk.max_scale_x - chunk.min_scale_x) + chunk.min_scale_x,
    );
    const scaleY = Math.exp(
      ((packed_scale >>> 11) & 1023) / 1023 * (chunk.max_scale_y - chunk.min_scale_y) + chunk.min_scale_y,
    );
    const scaleZ = Math.exp(
      (packed_scale & 2047) / 2047 * (chunk.max_scale_z - chunk.min_scale_z) + chunk.min_scale_z,
    );

    // ── 颜色 + 不透明度解包 ──
    // r: bits 24-31, g: bits 16-23, b: bits 8-15, opacity: bits 0-7
    const colorR = ((packed_color >>> 24) & 255) / 255 * (chunk.max_r - chunk.min_r) + chunk.min_r;
    const colorG = ((packed_color >>> 16) & 255) / 255 * (chunk.max_g - chunk.min_g) + chunk.min_g;
    const colorB = ((packed_color >>> 8) & 255) / 255 * (chunk.max_b - chunk.min_b) + chunk.min_b;
    const opacity = (packed_color & 255) / 255;

    splats.push({
      x, y, z,
      scaleX, scaleY, scaleZ,
      rotW, rotX, rotY, rotZ,
      colorR: clamp01(colorR),
      colorG: clamp01(colorG),
      colorB: clamp01(colorB),
      opacity: clamp01(opacity),
      shDegree: 0,
    });
  }

  return {
    splats,
    shDegree: 0,
    vertexCount: vertices.length,
    source,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─── L1: SoA 数据布局 ─────────────────────────────────────

/**
 * ★ L1: SoA (Struct of Arrays) 数据布局 — 大型场景内存优化
 *
 * 将高斯核属性从 AoS (Array of Structs) 转换为 SoA (Struct of Arrays),
 * 即从 GaussianSplat[] 转换为列式 TypedArray 存储。
 *
 * 优势:
 *   - 内存: 减少 ~30% (TypedArray vs JS 对象数组, 无 boxing)
 *   - GC: 减少 V8 堆压力 (TypedArray 在堆外分配)
 *   - 缓存局部性: 列式访问对 CPU cache 友好
 *   - 适合 >100K splat 的大型场景
 *
 * [来源: 会议决策 L1 — docs/party-mode-memories/2026-08-17-convert-quality-loss-memory.md]
 */
export interface GaussianCloudSoA {
  count: number;
  shDegree: number;
  source: string;
  positions: Float32Array;   // count * 3
  scales: Float32Array;      // count * 3
  rotations: Float32Array;   // count * 4
  colors: Float32Array;      // count * 3
  opacities: Float32Array;   // count
  sh?: Float32Array;         // count * totalShCoeffs (可选)
}

/**
 * ★ L1: 将 GaussianCloud (AoS) 转换为 GaussianCloudSoA (SoA)
 *
 * @param cloud AoS 格式的高斯核集合
 * @returns SoA 格式的高斯核集合
 */
export function toSoA(cloud: GaussianCloud): GaussianCloudSoA {
  const count = cloud.splats.length;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  const shCoeffsPerChannel = cloud.shDegree === 0 ? 0 : cloud.shDegree * (cloud.shDegree + 2);
  const totalShCoeffs = shCoeffsPerChannel * 3;
  const sh = totalShCoeffs > 0 ? new Float32Array(count * totalShCoeffs) : undefined;

  for (let i = 0; i < count; i++) {
    const s = cloud.splats[i];
    const i3 = i * 3;
    const i4 = i * 4;

    positions[i3] = s.x;
    positions[i3 + 1] = s.y;
    positions[i3 + 2] = s.z;

    scales[i3] = s.scaleX;
    scales[i3 + 1] = s.scaleY;
    scales[i3 + 2] = s.scaleZ;

    rotations[i4] = s.rotW;
    rotations[i4 + 1] = s.rotX;
    rotations[i4 + 2] = s.rotY;
    rotations[i4 + 3] = s.rotZ;

    colors[i3] = s.colorR;
    colors[i3 + 1] = s.colorG;
    colors[i3 + 2] = s.colorB;

    opacities[i] = s.opacity;

    if (sh && s.sh) {
      const shBase = i * totalShCoeffs;
      for (let j = 0; j < totalShCoeffs && j < s.sh.length; j++) {
        sh[shBase + j] = s.sh[j];
      }
    }
  }

  return {
    count,
    shDegree: cloud.shDegree,
    source: cloud.source,
    positions,
    scales,
    rotations,
    colors,
    opacities,
    sh,
  };
}

/**
 * ★ L1: 将 GaussianCloudSoA (SoA) 转换回 GaussianCloud (AoS)
 *
 * @param soa SoA 格式的高斯核集合
 * @returns AoS 格式的高斯核集合
 */
export function fromSoA(soa: GaussianCloudSoA): GaussianCloud {
  const count = soa.count;
  const splats: GaussianSplat[] = new Array(count);

  const shCoeffsPerChannel = soa.shDegree === 0 ? 0 : soa.shDegree * (soa.shDegree + 2);
  const totalShCoeffs = shCoeffsPerChannel * 3;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const i4 = i * 4;

    let sh: Float32Array | undefined;
    if (soa.sh && totalShCoeffs > 0) {
      sh = new Float32Array(totalShCoeffs);
      const shBase = i * totalShCoeffs;
      for (let j = 0; j < totalShCoeffs; j++) {
        sh[j] = soa.sh[shBase + j];
      }
    }

    splats[i] = {
      x: soa.positions[i3],
      y: soa.positions[i3 + 1],
      z: soa.positions[i3 + 2],
      scaleX: soa.scales[i3],
      scaleY: soa.scales[i3 + 1],
      scaleZ: soa.scales[i3 + 2],
      rotW: soa.rotations[i4],
      rotX: soa.rotations[i4 + 1],
      rotY: soa.rotations[i4 + 2],
      rotZ: soa.rotations[i4 + 3],
      colorR: soa.colors[i3],
      colorG: soa.colors[i3 + 1],
      colorB: soa.colors[i3 + 2],
      opacity: soa.opacities[i],
      sh,
      shDegree: soa.shDegree,
    };
  }

  return {
    splats,
    shDegree: soa.shDegree,
    vertexCount: count,
    source: soa.source,
  };
}
