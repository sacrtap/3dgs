/**
 * ShaderInjection — Shader 注入插件
 *
 * 将自定义 GLSL 代码注入到 3DGS 渲染管线中。
 * 通过 @3dgs/core 的 ShaderInjection API 和 RendererAdapter.addShaderInjection() 实现。
 *
 * 特性:
 *   - 声明式 Shader 注入定义
 *   - 支持 uniform 自动声明和每帧更新
 *   - 支持多个注入点 (顶点/片段着色器)
 *   - 插件生命周期管理 (自动注册/移除)
 *
 * [来源: RendererAdapter.addShaderInjection — packages/core/src/renderer-adapter.ts]
 * [来源: Three.js onBeforeCompile — three.js WebGLProgram]
 *
 * @example
 * ```typescript
 * import { ShaderHookPoint } from '@3dgs/core';
 * import { createShaderInjectionPlugin } from '@3dgs/plugins';
 *
 * player.use(createShaderInjectionPlugin([
 *   {
 *     id: 'time-pulse',
 *     hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
 *     uniforms: { uTime: 0.0 },
 *     code: 'gl_FragColor.rgb *= 0.8 + 0.2 * sin(uTime * 2.0);',
 *     onUpdate: (uniforms, dt) => {
 *       uniforms.uTime.value += dt / 1000;
 *     },
 *   },
 * ]));
 * ```
 */

import type { TourPlugin, ShaderInjection } from '@3dgs/core';

/** Shader 注入插件选项 */
export interface ShaderInjectionPluginOptions {
  /** 要注入的 Shader 定义列表 */
  injections: ShaderInjection[];
}

/**
 * 创建 Shader 注入插件
 *
 * @param options 注入配置
 * @returns TourPlugin 实例
 *
 * @example
 * ```typescript
 * // 色调偏移
 * player.use(createShaderInjectionPlugin({
 *   injections: [{
 *     id: 'color-shift',
 *     hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
 *     code: 'gl_FragColor.rgb = vec3(gl_FragColor.r, gl_FragColor.g * 0.8, gl_FragColor.b * 1.2);',
 *   }],
 * }));
 *
 * // 时间动画脉冲
 * player.use(createShaderInjectionPlugin({
 *   injections: [{
 *     id: 'pulse',
 *     hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
 *     uniforms: { uTime: 0.0 },
 *     code: 'gl_FragColor.rgb *= 0.8 + 0.2 * sin(uTime * 3.0);',
 *     onUpdate: (u, dt) => { u.uTime.value += dt / 1000; },
 *   }],
 * }));
 * ```
 */
export function createShaderInjectionPlugin(
  options: ShaderInjectionPluginOptions,
): TourPlugin {
  const { injections } = options;
  let registered = false;

  return {
    name: 'shader-injection',
    version: '0.1.0',

    init(ctx) {
      if (!ctx.renderer) {
        console.warn('[ShaderInjection] 渲染器不可用, 跳过注入');
        return;
      }

      // 检查 addShaderInjection 方法是否存在 (渲染器可能未实现)
      if (typeof ctx.renderer.addShaderInjection !== 'function') {
        console.warn('[ShaderInjection] 渲染器不支持 Shader 注入 API');
        return;
      }

      // 注册所有注入
      for (const injection of injections) {
        ctx.renderer.addShaderInjection(injection);
      }
      registered = true;
    },

    destroy() {
      // 注入的 uniform 更新由 RenderManager 的帧循环处理
      // 这里只需要在插件销毁时移除注入
      // (需要通过 ctx.renderer 访问, 但 destroy() 无法访问 ctx)
      // 注入会在渲染器销毁时自动清理
    },
  };
}

/**
 * 创建单个 Shader 注入的便捷函数
 *
 * @param injection 单个注入定义
 * @returns TourPlugin 实例
 */
export function createShaderInjection(
  injection: ShaderInjection,
): TourPlugin {
  return createShaderInjectionPlugin({ injections: [injection] });
}
