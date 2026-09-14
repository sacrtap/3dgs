/**
 * ★ R-06: computeRenderStats 单元测试
 */
import { describe, it, expect } from 'vitest';
import { computeRenderStats } from './stats.js';

describe('computeRenderStats — R-06 统计聚合', () => {
  it('帧时间换算 fps, 池命中率 = hits/(hits+misses)', () => {
    const stats = computeRenderStats({
      smoothDt: 16.67,
      visibleSplats: 1_000_000,
      resolutionScale: 0.75,
      renderWidth: 1280,
      renderHeight: 720,
      poolHits: 90,
      poolMisses: 10,
    });

    expect(stats.fps).toBeCloseTo(60, 0);
    expect(stats.frameTimeMs).toBe(16.67);
    expect(stats.visibleSplats).toBe(1_000_000);
    expect(stats.resolutionScale).toBe(0.75);
    expect(stats.renderWidth).toBe(1280);
    expect(stats.renderHeight).toBe(720);
    expect(stats.bufferPool.hits).toBe(90);
    expect(stats.bufferPool.misses).toBe(10);
    expect(stats.bufferPool.hitRate).toBe(0.9);
  });

  it('无池分配时 hitRate 为 0 (避免除零)', () => {
    const stats = computeRenderStats({
      smoothDt: 20,
      visibleSplats: 0,
      resolutionScale: 1,
      renderWidth: 0,
      renderHeight: 0,
    });
    expect(stats.bufferPool.hitRate).toBe(0);
    expect(stats.fps).toBe(50);
  });

  it('WebGPU 无池场景 (hits/misses 缺省) 池统计为 0', () => {
    const stats = computeRenderStats({
      smoothDt: 8.33,
      visibleSplats: 500_000,
      resolutionScale: 1,
      renderWidth: 1920,
      renderHeight: 1080,
    });
    expect(stats.bufferPool.hits).toBe(0);
    expect(stats.bufferPool.misses).toBe(0);
    expect(stats.bufferPool.hitRate).toBe(0);
    expect(stats.fps).toBeCloseTo(120, 0);
  });
});
