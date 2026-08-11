/**
 * DeviceTier 检测 — 根据设备能力自动选择渲染参数
 *
 * 检测维度:
 *   1. 硬件并发 (navigator.hardwareConcurrency)
 *   2. 设备内存 (navigator.deviceMemory)
 *   3. GPU 性能 (WebGL renderer 字符串)
 *   4. 是否移动设备
 */

import { DeviceTier } from '@3dgs/core';

export interface DeviceProfile {
  tier: DeviceTier;
  cores: number;
  memory: number;
  isMobile: boolean;
  gpuRenderer: string;
}

/** 检测设备能力并返回分级 */
export function detectDeviceTier(): DeviceProfile {
  // ★ CI 兼容: Node.js < 21 没有 navigator 全局对象
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores = nav?.hardwareConcurrency || 4;
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory || 4;
  const isMobile = nav ? /Android|iPhone|iPad|iPod/i.test(nav.userAgent) : false;
  const gpuRenderer = detectGpuRenderer();

  // ── 分级逻辑 ──
  let tier: DeviceTier;

  if (isMobile) {
    if (cores >= 6 && memory >= 4) {
      tier = DeviceTier.MEDIUM;
    } else {
      tier = DeviceTier.LOW;
    }
  } else {
    // 桌面端
    const isLowEndGpu = isIntegratedGpu(gpuRenderer);
    if (cores >= 8 && memory >= 8 && isHighEndGpu(gpuRenderer)) {
      tier = DeviceTier.ULTRA;
    } else if (cores >= 4 && memory >= 4 && !isLowEndGpu) {
      tier = DeviceTier.HIGH;
    } else if (cores >= 4 && memory >= 4) {
      tier = DeviceTier.MEDIUM;
    } else {
      tier = DeviceTier.LOW;
    }
  }

  return { tier, cores, memory, isMobile, gpuRenderer };
}

/** 根据设备分级获取推荐渲染参数 */
export function getTierSettings(tier: DeviceTier): {
  pixelRatio: number;
  resolutionScale: number;
  shDegree: number;
  maxSplats: number;
  antialias: boolean;
  /** LOD splat 缩放因子 (控制 LOD 目标 splat 数) */
  lodSplatScale: number;
  /** LOD 最小像素半径 (控制远处 splat 跳过阈值) */
  lodRenderScale: number;
  /** 高斯核标准差裁剪 (控制 overdraw, 越小越激进) */
  maxStdDev: number;
  /** 最小像素半径 (跳过过小 splat) */
  minPixelRadius: number;
  /** 视锥裁剪边界因子 (1.0=紧裁, 1.4=宽裁) */
  clipXY: number;
  /** 是否使用高质量 LOD */
  lodQuality: boolean;
  /** ★ P0: 排序最小间隔 (ms), 减少排序频率以提升帧率 */
  minSortIntervalMs: number;
  /** ★ P0: 注视点渲染 — 中心全分辨率锥角 (度) */
  coneFov0: number;
  /** ★ P0: 注视点渲染 — 边缘降分辨率锥角 (度) */
  coneFov: number;
  /** ★ P0: 注视点渲染 — 边缘分辨率缩放 (0-1) */
  coneFoveate: number;
  /** ★ P0: 注视点渲染 — 背后分辨率缩放 (0-1) */
  behindFoveate: number;
  /** ★ P1-1: PagedSplats 最大 GPU 内存页数 (splats 数, 必须是 65536 的倍数) */
  maxPagedSplats: number;
  /** ★ P1-1: 并行 chunk 获取器数量 (0-4, 超过 4 无效) */
  numLodFetchers: number;
  /** ★ L1: Splat 模糊量 — 添加到 2D 协方差对角线, 产生抗锯齿效果
   *  0.0 = 无模糊 (最锐利, 但可能有锯齿)
   *  0.1 = 轻微模糊 (适合低端设备, 减少 overdraw)
   *  0.3 = Spark 默认 (平衡质量和性能)
   *  [来源: Spark 源码 — spark.module.js:9874 this.blurAmount = options.blurAmount ?? 0.3]
   *  [来源: Spark 类型 — SparkRenderer.d.ts:100 blurAmount?: number]
   */
  blurAmount: number;
  /** ★ L1 衡生: 最小 alpha 渲染阈值 — 低于此值的 splat 被跳过 (discard)
   *  值越大, 跳过的透明 splat 越多, 性能越好 (减少 overdraw)
   *  0.5/255 ≈ 0.002 = Spark 默认 (几乎不跳过)
   *  2/255 ≈ 0.008 = 中等裁剪
   *  5/255 ≈ 0.020 = 激进裁剪 (适合低端设备)
   *  [来源: Spark 类型 — SparkRenderer.d.ts:73 minAlpha?: number, @default 0.5 * (1.0 / 255.0)]
   */
  minAlpha: number;
  /** ★ L1 衡生: 投影 splat 缩放校正值 — 控制锐利度
   *  1.0 = Spark 默认
   *  1.5 = 中等锐化
   *  2.0 = 匹配 PlayCanvas 渲染器 (最锐利)
   *  [来源: Spark 类型 — SparkRenderer.d.ts:130 focalAdjustment?: number, @default 1.0]
   */
  focalAdjustment: number;
} {
  switch (tier) {
    case DeviceTier.LOW:
      return {
        pixelRatio: 1.0, resolutionScale: 0.5, shDegree: 0, maxSplats: 250_000, antialias: false,
        lodSplatScale: 0.3, lodRenderScale: 3.0, maxStdDev: Math.sqrt(4), minPixelRadius: 2.0, clipXY: 1.0, lodQuality: false,
        minSortIntervalMs: 100, coneFov0: 60, coneFov: 90, coneFoveate: 0.3, behindFoveate: 0.1,
        maxPagedSplats: 4_194_304, numLodFetchers: 2, // 64 pages, 2 fetchers
        blurAmount: 0.1, // L1: 低模糊量, 减少 overdraw 提升性能
        minAlpha: 5 / 255, // L1 衡生: 激进裁剪透明 splat, 减少 overdraw
        focalAdjustment: 1.0, // L1 衡生: Spark 默认, 低端设备不做锐化
      };
    case DeviceTier.MEDIUM:
      return {
        pixelRatio: 1.0, resolutionScale: 0.75, shDegree: 0, maxSplats: 500_000, antialias: false,
        lodSplatScale: 0.5, lodRenderScale: 2.0, maxStdDev: Math.sqrt(6), minPixelRadius: 1.5, clipXY: 1.1, lodQuality: false,
        minSortIntervalMs: 50, coneFov0: 70, coneFov: 100, coneFoveate: 0.35, behindFoveate: 0.15,
        maxPagedSplats: 8_388_608, numLodFetchers: 3, // 128 pages, 3 fetchers
        blurAmount: 0.2, // L1: 中等模糊量, 平衡质量和性能
        minAlpha: 2 / 255, // L1 衡生: 中等裁剪透明 splat
        focalAdjustment: 1.0, // L1 衡生: Spark 默认
      };
    case DeviceTier.HIGH:
      return {
        pixelRatio: 1.0, resolutionScale: 1.0, shDegree: 1, maxSplats: 1_000_000, antialias: false,
        lodSplatScale: 1.0, lodRenderScale: 1.0, maxStdDev: Math.sqrt(8), minPixelRadius: 1.0, clipXY: 1.2, lodQuality: true,
        minSortIntervalMs: 33, coneFov0: 80, coneFov: 110, coneFoveate: 0.4, behindFoveate: 0.2,
        maxPagedSplats: 12_582_912, numLodFetchers: 3, // 192 pages, 3 fetchers
        blurAmount: 0.3, // L1: Spark 默认值, 平衡抗锯齿质量
        minAlpha: 1 / 255, // L1 衡生: 轻微裁剪, 质量优先
        focalAdjustment: 1.5, // L1 衡生: 中等锐化, 改善视觉质量
      };
    case DeviceTier.ULTRA:
      return {
        pixelRatio: 1.0, resolutionScale: 1.0, shDegree: 2, maxSplats: 2_500_000, antialias: false,
        lodSplatScale: 1.5, lodRenderScale: 1.0, maxStdDev: Math.sqrt(8), minPixelRadius: 0.5, clipXY: 1.4, lodQuality: true,
        minSortIntervalMs: 16, coneFov0: 90, coneFov: 120, coneFoveate: 0.4, behindFoveate: 0.2,
        maxPagedSplats: 16_777_216, numLodFetchers: 4, // 256 pages, 4 fetchers
        blurAmount: 0.3, // L1: Spark 默认值, 最高质量
        minAlpha: 0.5 / 255, // L1 衡生: Spark 默认, 几乎不裁剪
        focalAdjustment: 2.0, // L1 衡生: 匹配 PlayCanvas, 最锐利
      };
    default:
      return {
        pixelRatio: 1.0, resolutionScale: 0.75, shDegree: 0, maxSplats: 500_000, antialias: false,
        lodSplatScale: 0.5, lodRenderScale: 2.0, maxStdDev: Math.sqrt(6), minPixelRadius: 1.5, clipXY: 1.1, lodQuality: false,
        minSortIntervalMs: 50, coneFov0: 70, coneFov: 100, coneFoveate: 0.35, behindFoveate: 0.15,
        maxPagedSplats: 8_388_608, numLodFetchers: 3,
        blurAmount: 0.2, // L1: 中等模糊量
        minAlpha: 2 / 255, // L1 衡生: 中等裁剪
        focalAdjustment: 1.0, // L1 衡生: Spark 默认
      };
  }
}

// ─── 内部 ──────────────────────────────────────────────────

function detectGpuRenderer(): string {
  try {
    // ★ CI 兼容: Node.js 没有 document
    if (typeof document === 'undefined') return 'unknown';
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'unknown';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'unknown';
    return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
  } catch {
    return 'unknown';
  }
}

function isHighEndGpu(renderer: string): boolean {
  const r = renderer.toLowerCase();
  // NVIDIA RTX / AMD RDNA2+ / Apple M1+
  return /rtx 30|rtx 40|rtx 50|rx 60|rx 70|apple m1|apple m2|apple m3|apple m4/.test(r);
}

/** 检测是否为集成显卡 (Intel UHD/Iris, AMD Radeon Graphics 集成) */
function isIntegratedGpu(renderer: string): boolean {
  const r = renderer.toLowerCase();
  // Intel 集成显卡 (UHD, Iris, Iris Plus, Iris Xe)
  // AMD 集成显卡 (Radeon Graphics, Vega Mobile)
  return /intel.*iris|intel.*uhd|intel.*hd graphics|intel.*arc.*a380|radeon.*graphics|vega.*mobile|radeon.*vega.*8|radeon.*vega.*10|radeon.*vega.*3/.test(r);
}
