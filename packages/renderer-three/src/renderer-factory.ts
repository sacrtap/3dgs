/**
 * 渲染器工厂 — 自动选择 WebGPU / WebGL2 后端
 *
 * 策略:
 *   1. 检测 WebGPU 可用性
 *   2. 如果 WebGPU 可用且用户偏好 WebGPU → 使用 WebGPU 后端
 *   3. 否则 → 使用 WebGL2 后端 (Spark, 当前实现)
 *
 * 注意:
 *   当前 WebGPU 后端仍使用 Spark (WebGL2) 进行 splat 渲染,
 *   因为 Spark 尚不支持 WebGPU。WebGPU 检测和工厂架构已就位,
 *   未来集成 SuperSplat WGSL 着色器时可无缝切换。
 *
 * [来源: 项目源码 — packages/core/src/renderer-adapter.ts]
 * [来源: Spark README — "仅 WebGL2 (目标 98%+ 兼容性)"]
 */

import type { RendererAdapter } from '@3dgs/core';
import { RenderManager, type RenderManagerOptions } from './index.js';
import { detectWebGPU, isWebGPUMaybeAvailable, type WebGPUCapability } from './webgpu-detector.js';

/** 渲染后端类型 */
export type RendererBackend = 'webgpu' | 'webgl2';

/** 渲染器工厂选项 */
export interface CreateRendererOptions extends RenderManagerOptions {
  /** 偏好的后端类型 (默认 'webgpu', 不可用时回退) */
  preferredBackend?: RendererBackend;
  /** 是否强制使用指定后端 (不回退, 默认 false) */
  forceBackend?: boolean;
}

/** 渲染器工厂结果 */
export interface CreateRendererResult {
  /** 创建的渲染器实例 */
  renderer: RendererAdapter;
  /** 实际使用的后端 */
  backend: RendererBackend;
  /** WebGPU 能力检测结果 */
  webgpuCapability: WebGPUCapability;
}

/**
 * 创建渲染器 — 自动选择最佳后端
 *
 * @param options 渲染器选项
 * @returns 渲染器实例 + 后端信息
 *
 * @example
 * ```typescript
 * const { renderer, backend } = await createRenderer({ preferredBackend: 'webgpu' });
 * console.log(`使用 ${backend} 后端`);
 * ```
 */
export async function createRenderer(
  options: CreateRendererOptions = {},
): Promise<CreateRendererResult> {
  const {
    preferredBackend = 'webgpu',
    forceBackend = false,
    ...renderOptions
  } = options;

  // 检测 WebGPU
  const webgpuCapability = await detectWebGPU();

  // 决定后端
  let backend: RendererBackend;

  if (preferredBackend === 'webgpu' && webgpuCapability.supported) {
    backend = 'webgpu';
  } else if (preferredBackend === 'webgpu' && !forceBackend) {
    // WebGPU 不可用, 回退到 WebGL2
    backend = 'webgl2';
    console.warn(
      `[3dgs] WebGPU 不可用 (${webgpuCapability.reason}), 回退到 WebGL2 后端`,
    );
  } else if (preferredBackend === 'webgl2') {
    backend = 'webgl2';
  } else {
    // forceBackend=true 但 WebGPU 不可用
    throw new Error(
      `WebGPU 后端不可用: ${webgpuCapability.reason}`,
    );
  }

  // 创建渲染器
  // 当前: 无论选择哪个后端, 都使用 RenderManager (WebGL2 + Spark)
  // 未来: 当 SuperSplat WGSL 核心集成后, WebGPU 后端将使用独立的 WebGPURenderManager
  const renderer = new RenderManager(renderOptions);

  if (backend === 'webgpu') {
    // 标记为 WebGPU 模式 (当前仍使用 WebGL2 渲染, 但架构已准备就绪)
    console.info(
      `[3dgs] WebGPU 检测通过, 当前使用 WebGL2+Spark 渲染 (WebGPU splat 渲染为未来增强)`,
    );
    if (webgpuCapability.adapterInfo) {
      console.info(
        `[3dgs] GPU: ${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}`,
      );
    }
  }

  return { renderer, backend, webgpuCapability };
}

/**
 * 同步创建渲染器 (不等待 WebGPU 检测, 直接使用 WebGL2)
 *
 * 适用于不需要 WebGPU 检测的场景, 或 WebGPU 检测已在其他地方完成。
 */
export function createRendererSync(
  options: RenderManagerOptions = {},
): RendererAdapter {
  return new RenderManager(options);
}

export { detectWebGPU, isWebGPUMaybeAvailable };
export type { WebGPUCapability };
