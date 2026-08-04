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
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
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
} {
  switch (tier) {
    case DeviceTier.LOW:
      return {
        pixelRatio: 1.0, resolutionScale: 0.5, shDegree: 0, maxSplats: 250_000, antialias: false,
        lodSplatScale: 0.3, lodRenderScale: 3.0, maxStdDev: Math.sqrt(4), minPixelRadius: 2.0, clipXY: 1.0, lodQuality: false,
      };
    case DeviceTier.MEDIUM:
      return {
        pixelRatio: 1.0, resolutionScale: 0.75, shDegree: 0, maxSplats: 500_000, antialias: false,
        lodSplatScale: 0.5, lodRenderScale: 2.0, maxStdDev: Math.sqrt(6), minPixelRadius: 1.5, clipXY: 1.1, lodQuality: false,
      };
    case DeviceTier.HIGH:
      return {
        pixelRatio: 1.0, resolutionScale: 1.0, shDegree: 1, maxSplats: 1_000_000, antialias: false,
        lodSplatScale: 1.0, lodRenderScale: 1.0, maxStdDev: Math.sqrt(8), minPixelRadius: 1.0, clipXY: 1.2, lodQuality: true,
      };
    case DeviceTier.ULTRA:
      return {
        pixelRatio: 1.0, resolutionScale: 1.0, shDegree: 2, maxSplats: 2_500_000, antialias: false,
        lodSplatScale: 1.5, lodRenderScale: 1.0, maxStdDev: Math.sqrt(8), minPixelRadius: 0.5, clipXY: 1.4, lodQuality: true,
      };
    default:
      return {
        pixelRatio: 1.0, resolutionScale: 0.75, shDegree: 0, maxSplats: 500_000, antialias: false,
        lodSplatScale: 0.5, lodRenderScale: 2.0, maxStdDev: Math.sqrt(6), minPixelRadius: 1.5, clipXY: 1.1, lodQuality: false,
      };
  }
}

// ─── 内部 ──────────────────────────────────────────────────

function detectGpuRenderer(): string {
  try {
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
