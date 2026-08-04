/**
 * Shader 注入工具函数 — GLSL 代码注入辅助
 *
 * 这些函数是纯函数, 不依赖任何实例状态,
 * 从 RenderManager 中提取以降低文件复杂度。
 */

import * as THREE from 'three';

/** 在 main() 的开头插入代码 */
export function injectAfterMainBegin(shader: string, code: string): string {
  return shader.replace(
    /(void\s+main\s*\(\s*(?:void)?\s*\)\s*\{)/,
    `$1\n  ${code}`,
  );
}

/** 在指定正则模式之前插入代码 */
export function injectBeforePattern(shader: string, pattern: RegExp, code: string): string {
  const match = shader.match(pattern);
  if (!match || match.index === undefined) {
    console.warn(`[RenderManager] Shader 注入: 未找到匹配模式 ${pattern}`);
    return shader;
  }
  const idx = match.index;
  return shader.slice(0, idx) + code + '\n' + shader.slice(idx);
}

/** 在 main() 的结尾 (最后的 }) 之前插入代码 */
export function injectBeforeMainEnd(shader: string, code: string): string {
  const lastBrace = shader.lastIndexOf('}');
  if (lastBrace === -1) return shader;
  return shader.slice(0, lastBrace) + `  ${code}\n` + shader.slice(lastBrace);
}

/** 根据 JS 值推断 GLSL 类型 */
export function inferGLSLType(value: unknown): string | null {
  if (typeof value === 'number') return 'float';
  if (value instanceof THREE.Vector2) return 'vec2';
  if (value instanceof THREE.Vector3) return 'vec3';
  if (value instanceof THREE.Vector4) return 'vec4';
  if (value instanceof THREE.Matrix3) return 'mat3';
  if (value instanceof THREE.Matrix4) return 'mat4';
  if (value instanceof THREE.Color) return 'vec3';
  if (Array.isArray(value)) {
    if (value.length === 2) return 'vec2';
    if (value.length === 3) return 'vec3';
    if (value.length === 4) return 'vec4';
  }
  return null;
}
