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
    if (cores >= 8 && memory >= 8 && isHighEndGpu(gpuRenderer)) {
      tier = DeviceTier.ULTRA;
    } else if (cores >= 4 && memory >= 4) {
      tier = DeviceTier.HIGH;
    } else {
      tier = DeviceTier.MEDIUM;
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
} {
  switch (tier) {
    case DeviceTier.LOW:
      return { pixelRatio: 1.0, resolutionScale: 0.5, shDegree: 0, maxSplats: 250_000, antialias: false };
    case DeviceTier.MEDIUM:
      return { pixelRatio: 1.0, resolutionScale: 0.75, shDegree: 0, maxSplats: 500_000, antialias: false };
    case DeviceTier.HIGH:
      return { pixelRatio: 1.0, resolutionScale: 1.0, shDegree: 1, maxSplats: 1_000_000, antialias: false };
    case DeviceTier.ULTRA:
      return { pixelRatio: 1.0, resolutionScale: 1.0, shDegree: 2, maxSplats: 2_500_000, antialias: false };
    default:
      return { pixelRatio: 1.0, resolutionScale: 0.75, shDegree: 0, maxSplats: 500_000, antialias: false };
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
