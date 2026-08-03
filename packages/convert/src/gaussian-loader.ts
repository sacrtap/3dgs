/**
 * Gaussian 数据模型 — 将任意 PLY 归一化为 3DGS 高斯属性
 *
 * 支持:
 *   - 标准 3DGS PLY (含 opacity, scale, rotation, SH 系数)
 *   - 简单点云 PLY (仅 position + color) — 自动生成默认高斯属性
 *
 * [来源: 3DGS 原始论文 — Kerbl et al. 2023]
 * [来源: SPZ 格式 — github.com/nianticlabs/spz]
 * [来源: Spark 源码 — node_modules/@sparkjsdev/spark/dist/spark.module.js SpzWriter]
 */

import { parsePly, type PlyData } from './ply-parser.js';

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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
