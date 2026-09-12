/**
 * ★ R-06: 渲染统计聚合 — 纯函数, 双后端 (WebGL/WebGPU) 共用
 *
 * 聚合输入字段 → RenderStats; 幂等, 无副作用, 便于单元测试。
 */

import type { RenderStats } from '@3dgs/core';

/** 聚合输入 */
export interface RenderStatsInput {
  /** 平滑帧时间 (ms) */
  smoothDt: number;
  /** 可见 splat 数 */
  visibleSplats: number;
  /** 当前分辨率缩放 */
  resolutionScale: number;
  renderWidth: number;
  renderHeight: number;
  /** BufferPool 命中/未命中 (WebGPU 无池时 0/0) */
  poolHits?: number;
  poolMisses?: number;
}

/** 聚合为 RenderStats */
export function computeRenderStats(input: RenderStatsInput): RenderStats {
  const frameTimeMs = Math.max(input.smoothDt, 0.001);
  const hits = input.poolHits ?? 0;
  const misses = input.poolMisses ?? 0;
  const total = hits + misses;

  return {
    fps: 1000 / frameTimeMs,
    frameTimeMs,
    visibleSplats: input.visibleSplats,
    resolutionScale: input.resolutionScale,
    renderWidth: input.renderWidth,
    renderHeight: input.renderHeight,
    bufferPool: {
      hits,
      misses,
      hitRate: total > 0 ? hits / total : 0,
    },
  };
}
