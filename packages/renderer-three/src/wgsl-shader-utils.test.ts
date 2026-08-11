/**
 * WGSL Shader 注入工具测试 — ★ M4-P2.3
 */
import { describe, it, expect } from 'vitest';
import {
  injectWgslAfterMainBegin,
  injectWgslBeforeMainEnd,
  injectWgslBeforePattern,
  inferWgslType,
  wgslTypeSize,
  wgslTypeAlignedSize,
} from './wgsl-shader-utils.js';

// ── 测试用 WGSL 着色器 ────────────────────────────────────

const TEST_WGSL = /* wgsl */ `
struct Uniforms {
  vpMatrix: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.vpMatrix * vec4<f32>(0.0, 0.0, 0.0, 1.0);
  output.color = vec4<f32>(1.0, 0.0, 0.0, 1.0);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = input.color;
  return color;
}
`;

// ── injectWgslAfterMainBegin ──────────────────────────────

describe('WGSL Shader Utils — injectWgslAfterMainBegin', () => {
  it('★ 在 vs_main 开头注入代码', () => {
    const code = 'let injected = 1.0;';
    const result = injectWgslAfterMainBegin(TEST_WGSL, 'vs_main', code);
    expect(result).toContain('let injected = 1.0;');
    // 注入代码应在 output.position 之前
    const injectIdx = result.indexOf('let injected = 1.0;');
    const posIdx = result.indexOf('output.position');
    expect(injectIdx).toBeGreaterThan(-1);
    expect(posIdx).toBeGreaterThan(-1);
    expect(injectIdx).toBeLessThan(posIdx);
  });

  it('★ 在 fs_main 开头注入代码', () => {
    const code = 'let brightness = 1.5;';
    const result = injectWgslAfterMainBegin(TEST_WGSL, 'fs_main', code);
    expect(result).toContain('let brightness = 1.5;');
  });

  it('★ 函数不存在时返回原着色器', () => {
    const result = injectWgslAfterMainBegin(TEST_WGSL, 'nonexistent_fn', 'let x = 1.0;');
    expect(result).toBe(TEST_WGSL);
  });
});

// ── injectWgslBeforeMainEnd ───────────────────────────────

describe('WGSL Shader Utils — injectWgslBeforeMainEnd', () => {
  it('★ 在 vs_main 结尾注入代码', () => {
    const code = 'output.color.a = 0.5;';
    const result = injectWgslBeforeMainEnd(TEST_WGSL, 'vs_main', code);
    expect(result).toContain('output.color.a = 0.5;');
    // 注入代码应在 vs_main 函数体内 (在函数的闭合 } 之前)
    const injectIdx = result.indexOf('output.color.a = 0.5;');
    const fnEndIdx = result.lastIndexOf('}');
    expect(injectIdx).toBeGreaterThan(-1);
    expect(fnEndIdx).toBeGreaterThan(-1);
    expect(injectIdx).toBeLessThan(fnEndIdx);
  });

  it('★ 在 fs_main 结尾注入代码', () => {
    const code = 'let finalColor = color * 2.0;';
    const result = injectWgslBeforeMainEnd(TEST_WGSL, 'fs_main', code);
    expect(result).toContain('let finalColor = color * 2.0;');
  });

  it('★ 函数不存在时返回原着色器', () => {
    const result = injectWgslBeforeMainEnd(TEST_WGSL, 'nonexistent_fn', 'let x = 1.0;');
    expect(result).toBe(TEST_WGSL);
  });
});

// ── injectWgslBeforePattern ───────────────────────────────

describe('WGSL Shader Utils — injectWgslBeforePattern', () => {
  it('★ 在指定模式之前注入代码', () => {
    const code = '// before position';
    const result = injectWgslBeforePattern(TEST_WGSL, /output\.position\s*=/, code);
    expect(result).toContain('// before position');
    // 注入应在 output.position 之前
    const injectIdx = result.indexOf('// before position');
    const posIdx = result.indexOf('output.position');
    expect(injectIdx).toBeGreaterThan(-1);
    expect(posIdx).toBeGreaterThan(-1);
    expect(injectIdx).toBeLessThan(posIdx);
  });

  it('★ 模式未找到时返回原着色器', () => {
    const result = injectWgslBeforePattern(TEST_WGSL, /nonexistent_pattern/, 'let x = 1.0;');
    expect(result).toBe(TEST_WGSL);
  });
});

// ── inferWgslType ─────────────────────────────────────────

describe('WGSL Shader Utils — inferWgslType', () => {
  it('★ number → f32', () => {
    expect(inferWgslType(1.0)).toBe('f32');
    expect(inferWgslType(42)).toBe('f32');
  });

  it('★ array[2] → vec2<f32>', () => {
    expect(inferWgslType([1.0, 2.0])).toBe('vec2<f32>');
  });

  it('★ array[3] → vec3<f32>', () => {
    expect(inferWgslType([1.0, 2.0, 3.0])).toBe('vec3<f32>');
  });

  it('★ array[4] → vec4<f32>', () => {
    expect(inferWgslType([1.0, 2.0, 3.0, 4.0])).toBe('vec4<f32>');
  });

  it('★ null → null (无法推断)', () => {
    expect(inferWgslType(null)).toBeNull();
    expect(inferWgslType(undefined)).toBeNull();
    expect(inferWgslType('string')).toBeNull();
    expect(inferWgslType({})).toBeNull();
  });
});

// ── wgslTypeSize / wgslTypeAlignedSize ────────────────────

describe('WGSL Shader Utils — wgslTypeSize', () => {
  it('★ f32 = 4 bytes', () => {
    expect(wgslTypeSize('f32')).toBe(4);
  });

  it('★ vec2<f32> = 8 bytes', () => {
    expect(wgslTypeSize('vec2<f32>')).toBe(8);
  });

  it('★ vec3<f32> = 12 bytes', () => {
    expect(wgslTypeSize('vec3<f32>')).toBe(12);
  });

  it('★ vec4<f32> = 16 bytes', () => {
    expect(wgslTypeSize('vec4<f32>')).toBe(16);
  });

  it('★ 未知类型 = 0', () => {
    expect(wgslTypeSize('unknown')).toBe(0);
  });
});

describe('WGSL Shader Utils — wgslTypeAlignedSize', () => {
  it('★ f32 = 4 bytes (aligned)', () => {
    expect(wgslTypeAlignedSize('f32')).toBe(4);
  });

  it('★ vec3<f32> = 16 bytes (aligned, align=16 in uniform)', () => {
    expect(wgslTypeAlignedSize('vec3<f32>')).toBe(16);
  });

  it('★ vec4<f32> = 16 bytes (aligned)', () => {
    expect(wgslTypeAlignedSize('vec4<f32>')).toBe(16);
  });
});
