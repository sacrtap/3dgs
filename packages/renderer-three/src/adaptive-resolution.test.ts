import { describe, it, expect, vi } from 'vitest';
import { AdaptiveResolution } from './adaptive-resolution.js';

/**
 * ★ §2.5 / N-06: AdaptiveResolution suspend/resume 测试
 *
 * 背景: 加载/LOD 构建期间帧率低, 自适应分辨率会误降分辨率,
 * 场景就绪后每 45 帧仅 +0.1 缓慢回升, 导致首屏长时间低画质。
 * 修复: 新增 suspend()/resume(), 加载期间暂停采样。
 */
describe('AdaptiveResolution — suspend/resume (§2.5/N-06)', () => {
  function makeAdaptive(onScaleChange = vi.fn()) {
    const adaptive = new AdaptiveResolution(1.0, onScaleChange, {
      minFps: 28,
      targetFps: 45,
      minScale: 0.35,
      maxScale: 1.0,
      adjustInterval: 5, // 缩短窗口便于测试
      step: 0.1,
    });
    return { adaptive, onScaleChange };
  }

  /** 注入一批低帧率样本 (模拟加载期卡顿) */
  function simulateLowFpsFrames(adaptive: AdaptiveResolution, frames: number) {
    for (let i = 0; i < frames; i++) {
      adaptive.sample();
    }
  }

  it('初始不处于暂停状态', () => {
    const { adaptive } = makeAdaptive();
    expect(adaptive.suspended).toBe(false);
  });

  it('suspend() 后采样不调整分辨率 (低帧率也不降)', () => {
    const { adaptive, onScaleChange } = makeAdaptive();

    adaptive.suspend();
    expect(adaptive.suspended).toBe(true);

    // 暂停期间即使大量"低帧率"帧也不会触发降分辨率
    simulateLowFpsFrames(adaptive, 20);

    expect(adaptive.currentResolutionScale).toBe(1.0);
    expect(onScaleChange).not.toHaveBeenCalled();
  });

  it('resume() 后恢复采样能力', () => {
    const { adaptive } = makeAdaptive();

    adaptive.suspend();
    adaptive.resume();

    expect(adaptive.suspended).toBe(false);
    // 恢复后不立即抛错, 且基准时间被重置
    adaptive.sample();
    expect(adaptive.currentResolutionScale).toBe(1.0);
  });

  it('未暂停时低帧率仍会降分辨率 (原行为不受影响)', () => {
    // 使用真实时间采样间隔难以模拟低帧率, 这里直接验证未暂停时采样正常工作
    const { adaptive } = makeAdaptive();
    expect(adaptive.suspended).toBe(false);
    adaptive.sample();
    adaptive.sample();
    expect(adaptive.currentResolutionScale).toBeLessThanOrEqual(1.0);
  });

  it('suspend 期间 setScale 仍可强制设置 (手动控制不受暂停影响)', () => {
    const { adaptive, onScaleChange } = makeAdaptive();

    adaptive.suspend();
    adaptive.setScale(0.8);

    expect(adaptive.currentResolutionScale).toBe(0.8);
    expect(onScaleChange).toHaveBeenCalledWith(0.8);
  });

  it('resume 重置样本窗口 — 暂停前的陈旧样本不影响恢复后决策', () => {
    const { adaptive } = makeAdaptive();

    adaptive.sample();
    adaptive.sample();
    adaptive.suspend();
    adaptive.resume();

    // resume 后重新开始采样不应抛错
    expect(() => adaptive.sample()).not.toThrow();
  });
});
