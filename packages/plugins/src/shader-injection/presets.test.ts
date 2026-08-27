import { describe, it, expect, vi } from 'vitest';
import { ShaderHookPoint } from '@3dgs/core';
import { createPreset, presetId, SHADER_PRESET_NAMES } from './presets.js';

describe('ShaderPresets — 预设效果库', () => {
  it('全部预设可创建且结构合法', () => {
    expect(SHADER_PRESET_NAMES.length).toBe(8);
    for (const name of SHADER_PRESET_NAMES) {
      const inj = createPreset(name);
      expect(inj.id).toBe(presetId(name));
      expect(inj.hook).toBe(ShaderHookPoint.FRAGMENT_MAIN_END);
      expect(typeof inj.code).toBe('string');
    }
  });

  it('调色类预设包含强度插值 (mix)', () => {
    for (const name of ['cool', 'warm', 'grayscale', 'sepia', 'invert'] as const) {
      const inj = createPreset(name, { intensity: 0.7 });
      expect(inj.code).toContain('0.700');
      expect(inj.code).toContain('mix');
    }
  });

  it('强度参数默认 0.5', () => {
    const inj = createPreset('cool');
    expect(inj.code).toContain('0.500');
  });

  it('vignette 带 uIntensity 与 uResolution uniforms', () => {
    const inj = createPreset('vignette', { intensity: 0.8 });
    expect(inj.uniforms).toBeDefined();
    expect(inj.uniforms!.uIntensity).toBe(0.8);
    expect(Array.isArray(inj.uniforms!.uResolution)).toBe(true);
    expect(inj.code).toContain('gl_FragCoord');
  });

  it('pulse: onUpdate 递增 uTime (受 speed 影响)', () => {
    const inj = createPreset('pulse', { speed: 2 });
    expect(inj.onUpdate).toBeDefined();
    const uniforms = { uTime: { value: 0 } } as unknown as Record<string, unknown>;
    inj.onUpdate!(uniforms, 1000); // 1 秒
    expect((uniforms.uTime as { value: number }).value).toBeCloseTo(2, 5);
  });

  it('scanline: onUpdate 递增 uTime 且 code 含扫描线公式', () => {
    const inj = createPreset('scanline');
    const uniforms = { uTime: { value: 0 } } as unknown as Record<string, unknown>;
    inj.onUpdate!(uniforms, 500);
    expect((uniforms.uTime as { value: number }).value).toBeGreaterThan(0);
    expect(inj.code).toContain('sin');
  });

  it('presetId 规则稳定 (便于按名移除)', () => {
    expect(presetId('sepia')).toBe('preset-sepia');
    expect(presetId('vignette')).toBe('preset-vignette');
  });

  it('非动画预设不带 onUpdate', () => {
    for (const name of ['cool', 'warm', 'grayscale', 'sepia', 'invert'] as const) {
      expect(createPreset(name).onUpdate).toBeUndefined();
    }
  });
});
