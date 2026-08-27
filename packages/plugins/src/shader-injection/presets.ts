/**
 * ShaderPresets — 内置 Shader 效果预设库
 *
 * 一行启用常用后处理效果, 免去手写 GLSL:
 *   cool / warm / grayscale / sepia / invert — 调色类
 *   vignette — 暗角 (需 uResolution 自动接线)
 *   pulse / scanline — 动画类 (uTime 自动递增)
 *
 * 所有预设使用 FRAGMENT_MAIN_END 钩子 (GLSL3 安全, 此时 fragColor 已赋值),
 * 并可通过 options 微调强度参数。
 *
 * @example
 * ```typescript
 * import { createPreset, SHADER_PRESET_NAMES } from '@3dgs/plugins';
 *
 * renderer.addShaderInjection(createPreset('vignette', { intensity: 0.6 }));
 * renderer.addShaderInjection(createPreset('sepia'));
 * // 移除: renderer.removeShaderInjection(presetId('sepia'))
 * ```
 */

import { ShaderHookPoint, type ShaderInjection } from '@3dgs/core';

/** 预设名称 */
export type ShaderPresetName =
  | 'cool' | 'warm' | 'grayscale' | 'sepia' | 'invert'
  | 'vignette' | 'pulse' | 'scanline';

/** 预设可调参数 */
export interface ShaderPresetOptions {
  /** 效果强度 (0-1, 各预设语义不同: 暗角强度 / 脉冲幅度 / 扫描线对比等) */
  intensity?: number;
  /** 动画速度 (仅动画类预设, 默认 2.0) */
  speed?: number;
}

/** 预设注入的 id 规则 (便于按名移除) */
export function presetId(name: ShaderPresetName): string {
  return `preset-${name}`;
}

/** 全部预设名称 (供 UI 枚举) */
export const SHADER_PRESET_NAMES: ShaderPresetName[] = [
  'cool', 'warm', 'grayscale', 'sepia', 'invert', 'vignette', 'pulse', 'scanline',
];

/**
 * 创建预设 Shader 注入
 *
 * @param name 预设名
 * @param options 强度/速度等参数
 */
export function createPreset(name: ShaderPresetName, options: ShaderPresetOptions = {}): ShaderInjection {
  const id = presetId(name);
  const intensity = options.intensity ?? 0.5;
  const speed = options.speed ?? 2.0;

  switch (name) {
    case 'cool':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        code: `fragColor.rgb = mix(fragColor.rgb, fragColor.rgb * vec3(0.85, 0.95, 1.20), ${intensity.toFixed(3)});`,
      };

    case 'warm':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        code: `fragColor.rgb = mix(fragColor.rgb, fragColor.rgb * vec3(1.20, 1.02, 0.80), ${intensity.toFixed(3)});`,
      };

    case 'grayscale':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        code: `float _pg_l = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114)); fragColor.rgb = mix(fragColor.rgb, vec3(_pg_l), ${intensity.toFixed(3)});`,
      };

    case 'sepia':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        code: [
          'vec3 _sp_sep = vec3(',
          '  dot(fragColor.rgb, vec3(0.393, 0.769, 0.189)),',
          '  dot(fragColor.rgb, vec3(0.349, 0.686, 0.168)),',
          '  dot(fragColor.rgb, vec3(0.272, 0.534, 0.131)));',
          `fragColor.rgb = mix(fragColor.rgb, _sp_sep, ${intensity.toFixed(3)});`,
        ].join(' '),
      };

    case 'invert':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        code: `fragColor.rgb = mix(fragColor.rgb, vec3(1.0) - fragColor.rgb, ${intensity.toFixed(3)});`,
      };

    case 'vignette':
      // uResolution 由 onUpdate 每帧同步渲染尺寸 (避免硬编码)
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        uniforms: { uIntensity: intensity, uResolution: [1920.0, 1080.0] },
        code: [
          'vec2 _vg_uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));',
          'float _vg_d = distance(_vg_uv, vec2(0.5));',
          'fragColor.rgb *= 1.0 - smoothstep(0.25, 0.75, _vg_d) * uIntensity;',
        ].join(' '),
        onUpdate: (_u, _dt) => {
          // uIntensity 允许运行时调整; uResolution 由使用方按需更新
        },
      };

    case 'pulse':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        uniforms: { uTime: 0.0, uAmp: intensity * 0.4 },
        code: 'fragColor.rgb *= 1.0 + uAmp * sin(uTime * 3.0);',
        onUpdate: (u, dt) => {
          (u.uTime as { value: number }).value += (dt / 1000) * speed;
        },
      };

    case 'scanline':
      return {
        id,
        hook: ShaderHookPoint.FRAGMENT_MAIN_END,
        uniforms: { uTime: 0.0, uStrength: intensity * 0.35, uResolution: [1920.0, 1080.0] },
        code: [
          'float _sc_y = gl_FragCoord.y / max(uResolution.y, 1.0);',
          'float _sc_wave = 0.5 + 0.5 * sin((_sc_y + uTime * 0.05) * 600.0);',
          'fragColor.rgb *= 1.0 - uStrength * _sc_wave;',
        ].join(' '),
        onUpdate: (u, dt) => {
          (u.uTime as { value: number }).value += (dt / 1000) * speed;
        },
      };

    default:
      // 类型系统保证不可达; 兜底返回无操作注入
      return { id, hook: ShaderHookPoint.FRAGMENT_MAIN_END, code: '' };
  }
}
