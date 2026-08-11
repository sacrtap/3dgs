/**
 * WebGPU 能力检测 — 跨机型兼容性评估
 *
 * 检测浏览器是否支持 WebGPU, 评估 GPU 能力, 并收集关键限制和特性。
 * 当 WebGPU 不可用或不满足最低要求时, 自动回退到 WebGL2 (Spark)。
 *
 * 兼容性矩阵:
 *   ┌─────────────────────────┬────────────┬──────────┬──────────────────┐
 *   │ 机型                     │ maxBuffer  │ 特性     │ 风险             │
 *   ├─────────────────────────┼────────────┼──────────┼──────────────────┤
 *   │ 桌面独显 (NVIDIA/AMD)   │ 4GB+       │ 20/22    │ 低 — 性能充足    │
 *   │ 桌面集显 (Intel Iris)   │ 2GB        │ 16/22    │ 中 — GPU 超时    │
 *   │ Apple M 系列             │ 4GB+       │ 18/22    │ 低 — 统一内存    │
 *   │ 移动 Android             │ 256MB-1GB  │ ETC2     │ 高 — 内存受限    │
 *   │ 移动 iOS                 │ 256MB-1GB  │ ASTC     │ 高 — 内存受限    │
 *   │ 软件渲染 (SwiftShader)  │ 极有限     │ 最小     │ 极高 — 不可用    │
 *   └─────────────────────────┴────────────┴──────────┴──────────────────┘
 *
 * [来源: WebGPU API — developer.mozilla.org/en-US/docs/Web/API/WebGPU_API]
 * [来源: caniuse.com/webgpu — 覆盖率 ~85% (2026)]
 * [来源: WebGPU 规范 — gpuweb.github.io/gpuweb/#adapter-info]
 */

/** GPU 类型分类 */
export type GpuType = 'discrete' | 'integrated' | 'mobile' | 'software' | 'unknown';

/** 纹理压缩支持情况 */
export interface TextureCompressionSupport {
  /** BC / S3TC — 桌面端 (NVIDIA/AMD/Intel) */
  bc: boolean;
  /** ETC2 — Android 端 (Adreno/Mali) */
  etc2: boolean;
  /** ASTC — 移动端 (Apple A-series/M-series, 部分 Adreno) */
  astc: boolean;
}

/** WebGPU 关键限制 (用于兼容性检查) */
export interface WebGPULimits {
  /** 最大缓冲区大小 (bytes) — 决定可加载的最大 splat 数 */
  maxBufferSize: number;
  /** 最大存储缓冲区绑定大小 (bytes) */
  maxStorageBufferBindingSize: number;
  /** 最大绑定组数 — 影响管线设计 */
  maxBindGroups: number;
  /** 每着色器阶段最大存储缓冲区数 — 影响可绑定的 buffer 数 */
  maxStorageBuffersPerShaderStage: number;
  /** 计算工作组最大维度 — 影响 GPU 排序能力 */
  maxComputeWorkgroupsPerDimension: number;
  /** 最大均匀缓冲区绑定大小 (bytes) */
  maxUniformBufferBindingSize: number;
}

/** WebGPU 能力检测结果 */
export interface WebGPUCapability {
  /** WebGPU 是否可用 (且满足最低要求) */
  supported: boolean;
  /** GPU 适配器信息 (仅在 supported 时可用) */
  adapterInfo?: {
    vendor: string;
    architecture: string;
    description: string;
  };
  /** GPU 类型分类 */
  gpuType?: GpuType;
  /** 是否为回退适配器 (软件渲染, 如 SwiftShader) */
  isFallbackAdapter?: boolean;
  /** 首选画布格式 (bgra8unorm / rgba8unorm) */
  preferredCanvasFormat?: string;
  /** 纹理压缩支持 */
  textureCompression?: TextureCompressionSupport;
  /** 关键限制 */
  limits?: WebGPULimits;
  /** 支持的特性列表 (已启用的) */
  features?: string[];
  /** 性能评估 — 推荐的最大 splat 数 (基于 GPU 类型 + 限制) */
  recommendedMaxSplats?: number;
  /** 性能评估 — 推荐的分辨率缩放 (基于 GPU 类型) */
  recommendedResolutionScale?: number;
  /** 性能评估 — 推荐的排序间隔 ms (基于 GPU 类型) */
  recommendedSortIntervalMs?: number;
  /** 不可用原因 (仅在 supported=false 时) */
  reason?: string;
}

// ── GPU 类型检测 ──────────────────────────────────────────

/**
 * 根据 vendor + architecture 判断 GPU 类型
 *
 * [来源: WebGPU adapter.info — gpuweb.github.io/gpuweb/#adapter-info]
 * [来源: Intel GPU 架构 — en.wikipedia.org/wiki/Intel_Graphics_Technology]
 * [来源: ARM Mali GPU — developer.arm.com/ip-products/graphics-and-multimedia]
 */
function classifyGpuType(
  vendor: string,
  architecture: string,
  isFallback: boolean,
  isMobile: boolean,
): GpuType {
  const v = vendor.toLowerCase();
  const a = architecture.toLowerCase();

  // 软件回退适配器 (SwiftShader, LLVMpipe)
  // ★ 某些浏览器 (如 Chrome headless) 不设 isFallbackAdapter=true,
  //   但 vendor/architecture 中包含 'swiftshader' 或 'llvmpipe'
  if (isFallback) return 'software';
  if (v.includes('swiftshader') || a.includes('swiftshader') ||
      v.includes('llvmpipe') || a.includes('llvmpipe') ||
      v.includes('software') || a.includes('software')) {
    return 'software';
  }

  // 移动设备
  if (isMobile) return 'mobile';

  // 集成显卡检测
  // Intel: iris, uhd, hd graphics, arc a380 (入门级)
  // AMD: radeon graphics (APU 集成), vega mobile
  if (v === 'intel') return 'integrated';
  if (/radeon.*graphics|vega.*mobile|radeon.*vega.*[38]|radeon.*vega.*10/.test(a)) return 'integrated';

  // 离散显卡
  // NVIDIA: 所有桌面 GPU
  // AMD: radeon rx, radeon pro
  // Apple: m1/m2/m3/m4 (统一内存但性能接近离散)
  if (v === 'nvidia') return 'discrete';
  if (v === 'apple' && /m[1-4]/.test(a)) return 'discrete'; // Apple M 系列归为 discrete (性能充足)
  if (/radeon.*rx|radeon.*pro/.test(a)) return 'discrete';

  // ARM Mali / Adreno (移动 GPU 在桌面浏览器中)
  if (v === 'arm' || v === 'qualcomm') return 'mobile';

  return 'unknown';
}

/**
 * 根据报告检测机型配置, 推荐渲染参数
 *
 * @param gpuType GPU 类型
 * @param maxBufferSize GPU 最大缓冲区大小
 * @param isFallback 是否为软件回退
 */
function recommendSettings(
  gpuType: GpuType,
  maxBufferSize: number,
  isFallback: boolean,
): { maxSplats: number; resolutionScale: number; sortIntervalMs: number } {
  // 软件渲染 — 不可用
  if (gpuType === 'software' || isFallback) {
    return { maxSplats: 0, resolutionScale: 0, sortIntervalMs: 0 };
  }

  switch (gpuType) {
    case 'discrete':
      // 离散显卡: 性能充足, 可处理大场景
      // maxBufferSize >= 4GB → 可加载 5M+ splats
      // 但限制到 2.5M 以保证 60fps
      return {
        maxSplats: Math.min(2_500_000, Math.floor(maxBufferSize / 64)),
        resolutionScale: 1.0,
        sortIntervalMs: 16,
      };

    case 'integrated':
      // 集成显卡: 共享内存, GPU 超时风险
      // maxBufferSize 通常 = 2GB → 限制到 500K splats
      // 降低分辨率减少 fragment shader 负载
      return {
        maxSplats: Math.min(500_000, Math.floor(maxBufferSize / 128)),
        resolutionScale: 0.75,
        sortIntervalMs: 50, // 较长间隔减少 GPU 负载
      };

    case 'mobile':
      // 移动 GPU: 内存受限, 热节流风险
      // maxBufferSize 通常 = 256MB-1GB → 限制到 250K splats
      return {
        maxSplats: Math.min(250_000, Math.floor(maxBufferSize / 256)),
        resolutionScale: 0.5,
        sortIntervalMs: 100,
      };

    case 'unknown':
    default:
      // 未知 GPU: 保守设置
      return {
        maxSplats: Math.min(500_000, Math.floor(maxBufferSize / 128)),
        resolutionScale: 0.75,
        sortIntervalMs: 50,
      };
  }
}

// ── 特性检测辅助 ──────────────────────────────────────────

/**
 * 安全读取 adapter.features (Set<GPUFeatureName>)
 *
 * 不同浏览器版本对 features 的支持不同, 需要安全检测。
 */
function getAdapterFeatures(adapter: GPUAdapter): string[] {
  try {
    const features = (adapter as unknown as { features: Set<string> }).features;
    if (features && typeof features.has === 'function') {
      return Array.from(features);
    }
  } catch {
    // 旧版浏览器可能不支持 adapter.features
  }
  return [];
}

/**
 * 检测纹理压缩支持
 */
function detectTextureCompression(features: string[]): TextureCompressionSupport {
  return {
    bc: features.includes('texture-compression-bc'),
    etc2: features.includes('texture-compression-etc2'),
    astc: features.includes('texture-compression-astc'),
  };
}

// ── 主检测函数 ────────────────────────────────────────────

/**
 * 检测 WebGPU 能力 — 全面评估跨机型兼容性
 *
 * 检测步骤:
 *   1. 检查 navigator.gpu 是否存在
 *   2. 请求 GPU 适配器 (偏好高性能)
 *   3. 检测是否为回退适配器 (软件渲染)
 *   4. 收集适配器信息 (vendor, architecture)
 *   5. 请求 GPU 设备并收集限制
 *   6. 检测支持的特性 (纹理压缩, f16 等)
 *   7. 分类 GPU 类型 (集成/离散/移动/软件)
 *   8. 根据类型推荐渲染参数
 *   9. 验证最低要求 (maxBufferSize >= 128MB)
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

    // 2. 请求适配器 (偏好高性能 GPU)
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        supported: false,
        reason: '无法获取 WebGPU 适配器 — 可能没有兼容的 GPU 硬件',
      };
    }

    // 3. 检测回退适配器 (软件渲染, 如 SwiftShader)
    const isFallbackAdapter = Boolean(
      (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter,
    );

    // 4. 收集适配器信息
    let adapterInfo: WebGPUCapability['adapterInfo'];
    try {
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

    // 5. 请求设备并收集限制
    const device = await adapter.requestDevice();

    // 6. 检测支持的特性
    const featureList = getAdapterFeatures(adapter);
    const textureCompression = detectTextureCompression(featureList);

    // 7. 收集关键限制
    const limits: WebGPULimits = {
      maxBufferSize: device.limits.maxBufferSize,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBindGroups: device.limits.maxBindGroups,
      maxStorageBuffersPerShaderStage: device.limits.maxStorageBuffersPerShaderStage,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
      maxUniformBufferBindingSize: device.limits.maxUniformBufferBindingSize,
    };

    // 8. 获取首选画布格式
    const preferredCanvasFormat = gpu.getPreferredCanvasFormat();

    // 9. 分类 GPU 类型
    const isMobile = typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const gpuType = classifyGpuType(
      adapterInfo?.vendor ?? 'unknown',
      adapterInfo?.architecture ?? 'unknown',
      isFallbackAdapter,
      isMobile,
    );

    device.destroy();

    // 10. 验证最低要求
    // 软件渲染不可用
    if (gpuType === 'software' || isFallbackAdapter) {
      return {
        supported: false,
        adapterInfo,
        gpuType,
        isFallbackAdapter,
        preferredCanvasFormat,
        textureCompression,
        limits,
        features: featureList,
        reason: 'WebGPU 使用软件渲染 (SwiftShader/LLVMpipe), 性能不足以进行 3DGS 渲染',
      };
    }

    // maxBufferSize 必须 >= 128MB (至少 4M splats × 32 bytes)
    const MIN_BUFFER_SIZE = 128 * 1024 * 1024;
    if (limits.maxBufferSize < MIN_BUFFER_SIZE) {
      return {
        supported: false,
        adapterInfo,
        gpuType,
        isFallbackAdapter,
        preferredCanvasFormat,
        textureCompression,
        limits,
        features: featureList,
        reason: `GPU maxBufferSize 过小 (${(limits.maxBufferSize / 1024 / 1024).toFixed(0)}MB < 128MB), 无法加载 3DGS 场景`,
      };
    }

    // maxBindGroups 必须 >= 2 (当前管线使用 1 个 bind group)
    if (limits.maxBindGroups < 2) {
      return {
        supported: false,
        adapterInfo,
        gpuType,
        isFallbackAdapter,
        preferredCanvasFormat,
        textureCompression,
        limits,
        features: featureList,
        reason: `GPU maxBindGroups 过小 (${limits.maxBindGroups} < 2), 不满足管线需求`,
      };
    }

    // 11. 推荐渲染参数
    const recommendations = recommendSettings(gpuType, limits.maxBufferSize, isFallbackAdapter);

    return {
      supported: true,
      adapterInfo,
      gpuType,
      isFallbackAdapter,
      preferredCanvasFormat,
      textureCompression,
      limits,
      features: featureList,
      recommendedMaxSplats: recommendations.maxSplats,
      recommendedResolutionScale: recommendations.resolutionScale,
      recommendedSortIntervalMs: recommendations.sortIntervalMs,
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

// ── WebGPU 类型由 @webgpu/types 包提供 ──
// [来源: @webgpu/types — npm 包, 提供 WebGPU API 的 TypeScript 类型定义]
