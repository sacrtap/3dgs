/**
 * WebGPU 能力检测
 *
 * 检测浏览器是否支持 WebGPU, 并评估 GPU 能力。
 * 当 WebGPU 不可用时, 自动回退到 WebGL2 (Spark)。
 *
 * [来源: WebGPU API — developer.mozilla.org/en-US/docs/Web/API/WebGPU_API]
 * [来源: caniuse.com/webgpu — 覆盖率 ~85% (2026)]
 */

/** WebGPU 能力检测结果 */
export interface WebGPUCapability {
  /** WebGPU 是否可用 */
  supported: boolean;
  /** GPU 适配器信息 (仅在 supported 时可用) */
  adapterInfo?: {
    vendor: string;
    architecture: string;
    description: string;
  };
  /** GPU 最大存储缓冲大小 */
  maxBufferSize?: number;
  /** GPU 最大工作组的 X 维度 */
  maxComputeWorkgroupsPerDimension?: number;
  /** 不可用原因 (仅在 supported=false 时) */
  reason?: string;
}

/**
 * 检测 WebGPU 能力
 *
 * 检测步骤:
 *   1. 检查 navigator.gpu 是否存在
 *   2. 请求 GPU 适配器
 *   3. 请求 GPU 设备
 *   4. 收集适配器信息
 *
 * @returns WebGPU 能力检测结果
 */
export async function detectWebGPU(): Promise<WebGPUCapability> {
  // 1. 检查 navigator.gpu
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      supported: false,
      reason: 'navigator.gpu 不可用 — 浏览器不支持 WebGPU',
    };
  }

  try {
    const gpu = (navigator as unknown as { gpu: GPU }).gpu;

    // 2. 请求适配器
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        supported: false,
        reason: '无法获取 WebGPU 适配器 — 可能没有兼容的 GPU 硬件',
      };
    }

    // 3. 请求设备 (验证可用性)
    const device = await adapter.requestDevice();

    // 4. 收集适配器信息
    let adapterInfo: WebGPUCapability['adapterInfo'];

    try {
      // adapter.info 在较新浏览器中可用
      const info = (adapter as unknown as { info?: { vendor: string; architecture: string; description: string } }).info;
      if (info) {
        adapterInfo = {
          vendor: info.vendor || 'unknown',
          architecture: info.architecture || 'unknown',
          description: info.description || '',
        };
      }
    } catch {
      // 旧版浏览器可能不支持 adapter.info
    }

    const maxBufferSize = device.limits.maxBufferSize;
    const maxComputeWorkgroupsPerDimension = device.limits.maxComputeWorkgroupsPerDimension;

    device.destroy();

    return {
      supported: true,
      adapterInfo,
      maxBufferSize,
      maxComputeWorkgroupsPerDimension,
    };
  } catch (err) {
    return {
      supported: false,
      reason: `WebGPU 初始化失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 同步快速检测 WebGPU 是否可能可用 (不等待适配器)
 *
 * 仅检查 navigator.gpu 是否存在, 用于快速决策。
 * 完整的异步检测请使用 detectWebGPU()。
 */
export function isWebGPUMaybeAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// ── WebGPU 类型声明 (最小子集) ──

interface GPU {
  requestAdapter(options?: { powerPreference?: string }): Promise<GPUAdapter | null>;
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
  info?: { vendor: string; architecture: string; description: string };
}

interface GPUDevice {
  limits: {
    maxBufferSize: number;
    maxComputeWorkgroupsPerDimension: number;
  };
  destroy(): void;
}
