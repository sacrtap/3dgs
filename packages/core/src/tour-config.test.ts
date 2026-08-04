import { describe, it, expect } from 'vitest';
import { validateTourConfig, TourConfigValidationError } from './tour-config.js';

describe('validateTourConfig', () => {
  it('通过验证有效的配置', () => {
    const config = {
      version: '1.0',
      scenes: {
        scene1: { source: 'scene1.splat' },
      },
    };
    expect(validateTourConfig(config)).toBe(true);
  });

  it('拒绝非对象配置', () => {
    expect(() => validateTourConfig(null)).toThrow(TourConfigValidationError);
    expect(() => validateTourConfig('string')).toThrow(TourConfigValidationError);
    expect(() => validateTourConfig(42)).toThrow(TourConfigValidationError);
  });

  it('拒绝不支持的版本', () => {
    const config = {
      version: '2.0',
      scenes: { scene1: { source: 'a.splat' } },
    };
    expect(() => validateTourConfig(config)).toThrow(/不支持的 version/);
  });

  it('拒绝缺少 scenes 字段', () => {
    const config = { version: '1.0' };
    expect(() => validateTourConfig(config)).toThrow(/缺少 scenes/);
  });

  it('拒绝空 scenes 对象', () => {
    const config = { version: '1.0', scenes: {} };
    expect(() => validateTourConfig(config)).toThrow(/至少需要一个场景/);
  });

  it('拒绝缺少 source 的场景', () => {
    const config = {
      version: '1.0',
      scenes: { scene1: { title: 'no source' } },
    };
    expect(() => validateTourConfig(config)).toThrow(/缺少 source/);
  });

  it('接受包含 meta 和 defaults 的完整配置', () => {
    const config = {
      version: '1.0',
      meta: { title: 'Test Tour' },
      defaults: {
        camera: { fov: 75, minFov: 30, maxFov: 90, limitPitch: [-90, 90] },
        transition: { type: 'fade' as const, duration: 500 },
        quality: { maxSplats: 1000000, shDegree: 1, resolution: 1.0, antialias: false, pixelRatio: 1.0 },
      },
      scenes: {
        s1: { source: 's1.splat', initialView: { yaw: 0, pitch: 0, fov: 75 } },
        s2: { source: 's2.spz', lodSource: 's2.sog' },
      },
    };
    expect(validateTourConfig(config)).toBe(true);
  });
});
