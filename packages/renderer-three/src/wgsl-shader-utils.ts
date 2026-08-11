/**
 * WGSL Shader 注入工具 — 将自定义 WGSL 代码注入到着色器管线的指定位置
 *
 * ★ M4-P2.3: Shader 注入功能化
 *
 * 与 GLSL shader-utils.ts 的区别:
 * - WGSL 语法: `fn vs_main(...) -> ... { ... }` 而非 `void main() { ... }`
 * - WGSL uniform: `@group(N) @binding(M) var<uniform> name: type;` 而非 `uniform type name;`
 * - WGSL 类型: `f32`, `vec2<f32>`, `vec3<f32>`, `vec4<f32>` 而非 `float`, `vec2`, `vec3`, `vec4`
 *
 * [来源: WGSL 规范 — www.w3.org/TR/WGSL/]
 * [来源: M4-P2.3 — Shader 注入功能化需求]
 */

/**
 * 在 WGSL 函数 main() 的开头插入代码
 *
 * @param shader WGSL 着色器源码
 * @param fnName 函数名 (如 'vs_main', 'fs_main')
 * @param code 要注入的 WGSL 代码
 * @returns 修改后的 WGSL 源码
 */
export function injectWgslAfterMainBegin(shader: string, fnName: string, code: string): string {
  // 匹配: fn <fnName>(...) -> ... {  或  fn <fnName>(...) {
  // ★ 使用 [^{]* 匹配参数列表 (可能包含嵌套括号, 如 @builtin(vertex_index))
  const pattern = new RegExp(`(fn\\s+${fnName}\\s*\\([^{]*\\{)`);
  const match = shader.match(pattern);
  if (!match) {
    console.warn(`[WGSL Inject] 未找到函数 ${fnName} 的 main 入口`);
    return shader;
  }
  return shader.replace(pattern, `$1\n  ${code}`);
}

/**
 * 在 WGSL 函数的结尾 (最后的 }) 之前插入代码
 *
 * @param shader WGSL 着色器源码
 * @param fnName 函数名
 * @param code 要注入的 WGSL 代码
 * @returns 修改后的 WGSL 源码
 */
export function injectWgslBeforeMainEnd(shader: string, fnName: string, code: string): string {
  // 找到函数定义
  const fnPattern = new RegExp(`fn\\s+${fnName}\\s*\\(`);
  const fnMatch = shader.match(fnPattern);
  if (!fnMatch || fnMatch.index === undefined) {
    console.warn(`[WGSL Inject] 未找到函数 ${fnName}`);
    return shader;
  }

  // 找到函数体的开始大括号
  let braceStart = shader.indexOf('{', fnMatch.index);
  if (braceStart === -1) return shader;

  // 找到匹配的结束大括号
  let depth = 1;
  let i = braceStart + 1;
  while (i < shader.length && depth > 0) {
    if (shader[i] === '{') depth++;
    if (shader[i] === '}') depth--;
    i++;
  }

  if (depth !== 0) return shader;
  const lastBrace = i - 1;
  return shader.slice(0, lastBrace) + `  ${code}\n` + shader.slice(lastBrace);
}

/**
 * 在指定正则模式之前插入代码
 *
 * @param shader WGSL 着色器源码
 * @param pattern 要匹配的正则模式
 * @param code 要注入的 WGSL 代码
 * @returns 修改后的 WGSL 源码
 */
export function injectWgslBeforePattern(shader: string, pattern: RegExp, code: string): string {
  const match = shader.match(pattern);
  if (!match || match.index === undefined) {
    console.warn(`[WGSL Inject] 未找到匹配模式 ${pattern}`);
    return shader;
  }
  const idx = match.index;
  return shader.slice(0, idx) + code + '\n' + shader.slice(idx);
}

/**
 * 根据 JS 值推断 WGSL 类型
 *
 * @param value JS 值
 * @returns WGSL 类型字符串, 或 null (无法推断)
 */
export function inferWgslType(value: unknown): string | null {
  if (typeof value === 'number') return 'f32';
  if (Array.isArray(value)) {
    if (value.length === 2) return 'vec2<f32>';
    if (value.length === 3) return 'vec3<f32>';
    if (value.length === 4) return 'vec4<f32>';
  }
  return null;
}

/**
 * 计算 WGSL uniform 类型的字节大小
 *
 * @param wgslType WGSL 类型字符串
 * @returns 字节大小, 或 0 (未知类型)
 */
export function wgslTypeSize(wgslType: string): number {
  if (wgslType === 'f32' || wgslType === 'u32' || wgslType === 'i32') return 4;
  if (wgslType === 'vec2<f32>') return 8;
  if (wgslType === 'vec3<f32>') return 12; // 实际 16 (对齐), 但 size 12
  if (wgslType === 'vec4<f32>') return 16;
  return 0;
}

/**
 * 计算 WGSL uniform 类型的对齐要求
 *
 * @param wgslType WGSL 类型字符串
 * @returns 对齐+大小 (aligned size), 或 0 (未知类型)
 */
export function wgslTypeAlignedSize(wgslType: string): number {
  if (wgslType === 'f32' || wgslType === 'u32' || wgslType === 'i32') return 4;
  if (wgslType === 'vec2<f32>') return 8;
  if (wgslType === 'vec3<f32>') return 16; // align=16 in uniform
  if (wgslType === 'vec4<f32>') return 16;
  return 0;
}
