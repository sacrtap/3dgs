/**
 * 渲染器工厂 — 自动选择 WebGPU / WebGL2 后端
 *
 * ★ P3-1: 真正的双后端切换
 *
 * 策略:
 *   1. 检测 WebGPU 可用性
 *   2. 如果 WebGPU 可用且用户偏好 WebGPU → 使用 WebGPURenderManager
 *   3. 否则 → 使用 RenderManager (WebGL2 + Spark)
 *
 * [来源: 项目源码 — packages/core/src/renderer-adapter.ts]
 * [来源: P3-1 优化方案 — docs/plan/07-性能深度分析与优化执行方案.md §11.1]
 */

import type { RendererAdapter } from '@3dgs/core';
import { RenderManager, type RenderManagerOptions } from './index.js';
import { WebGPURenderManager, type WebGPURenderManagerOptions } from './webgpu-render-manager.js';
import { detectWebGPU, isWebGPUMaybeAvailable, type WebGPUCapability } from './webgpu-detector.js';

/** 渲染后端类型 */
export type RendererBackend = 'webgpu' | 'webgl2';

/** 渲染器工厂选项 */
export interface CreateRendererOptions extends RenderManagerOptions {
  /** 偏好的后端类型 (默认 'webgpu', 不可用时回退) */
  preferredBackend?: RendererBackend;
  /** 是否强制使用指定后端 (不回退, 默认 false) */
  forceBackend?: boolean;
  /** 是否启用 GPU 排序 (仅 WebGPU 后端, 默认 true) */
  enableGpuSort?: boolean;
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
 * ★ P3-1: 当 WebGPU 可用时, 使用 WebGPURenderManager 进行原生 WebGPU 渲染;
 *          否则回退到 RenderManager (WebGL2 + Spark)。
 *
 * @param options 渲染器选项
 * @returns 渲染器实例 + 后端信息
 *
 * @example
 * ```typescript
 * const { renderer, backend } = await createRenderer({ preferredBackend: 'webgpu' });
 * console.log(`使用 ${backend} 后端`);
 *
 * // WebGPU 后端需要先调用 init()
 * if (backend === 'webgpu') {
 *   await (renderer as WebGPURenderManager).init();
 * }
 * renderer.mount(container);
 * renderer.start();
 * ```
 */
export async function createRenderer(
  options: CreateRendererOptions = {},
): Promise<CreateRendererResult> {
  const {
    preferredBackend = 'webgpu',
    forceBackend = false,
    enableGpuSort = true,
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

  // 创建渲染器 — 根据后端选择不同的实现
  let renderer: RendererAdapter;

  if (backend === 'webgpu') {
    // ★ P3-1: 使用 WebGPURenderManager 进行原生 WebGPU 渲染
    const webgpuOptions: WebGPURenderManagerOptions = {
      deviceTier: renderOptions.deviceTier,
      pixelRatio: renderOptions.pixelRatio,
      resolutionScale: renderOptions.resolutionScale,
      adaptiveResolution: renderOptions.adaptiveResolution,
      clearColor: renderOptions.clearColor,
      enableKeyboardControls: renderOptions.enableKeyboardControls,
      moveSpeed: renderOptions.moveSpeed,
      verticalSpeed: renderOptions.verticalSpeed,
      autoOrient: renderOptions.autoOrient,
      enableLod: renderOptions.enableLod,
      enableGpuSort,
    };

    renderer = new WebGPURenderManager(webgpuOptions);

    // ★ 跨机型兼容: 应用 GPU 能力检测结果
    // 根据 GPU 类型 (集成/离散/移动/软件) 调整 maxSplats, resolutionScale, sortIntervalMs
    if (typeof (renderer as WebGPURenderManager).applyCapability === 'function') {
      (renderer as WebGPURenderManager).applyCapability(webgpuCapability);
    }

    // 打印 GPU 信息
    const gpuTypeLabel = webgpuCapability.gpuType
      ? ` | 类型: ${webgpuCapability.gpuType}`
      : '';
    console.info(
      `[3dgs] 使用 WebGPU 原生渲染后端 (GPU 排序: ${enableGpuSort ? '启用' : '禁用'}${gpuTypeLabel})`,
    );
    if (webgpuCapability.adapterInfo) {
      console.info(
        `[3dgs] GPU: ${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}`,
      );
    }
    if (webgpuCapability.limits) {
      console.info(
        `[3dgs] GPU 限制: maxBufferSize=${(webgpuCapability.limits.maxBufferSize / 1024 / 1024).toFixed(0)}MB | ` +
        `maxBindGroups=${webgpuCapability.limits.maxBindGroups} | ` +
        `maxStorageBuffersPerShaderStage=${webgpuCapability.limits.maxStorageBuffersPerShaderStage}`,
      );
    }

    // 注意: WebGPURenderManager 需要调用者手动调用 init() 后再 mount/start
    // 这里不自动调用 init(), 因为它可能失败并需要回退
  } else {
    // WebGL2 后端: 使用 RenderManager (Spark)
    renderer = new RenderManager(renderOptions);
    console.info('[3dgs] 使用 WebGL2 + Spark 渲染后端');
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
