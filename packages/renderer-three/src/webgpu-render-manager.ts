/**
 * WebGPU 渲染管理器 — WebGPU 原生渲染后端
 *
 * ★ P3-1: 使用 WebGPU 实现 3DGS 渲染, 替代 WebGL2 + Spark
 *
 * 架构:
 *   1. WebGPU 设备 + Canvas 上下文初始化
 *   2. Splat 数据 → GPU Buffer 上传 (position, scale, color, rotation)
 *   3. WGSL 着色器渲染管线 (vertex + fragment)
 *   4. GPU 排序集成 (WebGPUSortManager)
 *   5. 实现 RendererAdapter 接口
 *
 * 渲染流程 (每帧):
 *   1. 更新相机 uniform (VP 矩阵 + 位置)
 *   2. GPU 排序 (WebGPUSortManager, compute shader)
 *   3. 渲染 pass (使用排序后的索引)
 *   4. 输出到 canvas
 *
 * 回退策略:
 *   - WebGPU 不可用时 → 回退到 RenderManager (WebGL2 + Spark)
 *   - GPU 排序不可用时 → 回退到 CPU 排序
 *
 * [来源: WebGPU API — developer.mozilla.org/en-US/docs/Web/API/WebGPU_API]
 * [来源: P3-1 优化方案 — docs/plan/07-性能深度分析与优化执行方案.md §11.1]
 * [来源: Spark SparkRenderer — @sparkjsdev/spark SparkRenderer.d.ts (着色器参考)]
 * [来源: 3DGS 渲染原理 — Kerbl et al. 2023, alpha blending back-to-front]
 */

import type { RendererAdapter, LoadOptions } from '@3dgs/core';
import { DeviceTier, ShaderHookPoint, type ShaderInjection } from '@3dgs/core';
import { detectDeviceTier, getTierSettings, type DeviceProfile } from './device-tier.js';
import { AdaptiveResolution } from './adaptive-resolution.js';
import { DragLookControls } from './drag-look-controls.js';
import { WebGPUSortManager, type SortResult } from './webgpu-sort-manager.js';
// ★ M4: 共享模块
import { KeyboardControls } from './keyboard-controls.js';
import { FrameCallbackManager } from './frame-callback-manager.js';
import { CameraMatrixCache } from './camera-matrix-cache.js';
// ★ M4-P2.2: 格式支持
import { SogStreamer } from './sog-streamer.js';
import { decodeSpzToSplatData } from './spz-decoder-worker.js';
// ★ TD-08: 双后端共享加载工具
import { fetchWithProgress } from './shared/fetch-util.js';
import { loadSogChunks, downsampleSplatData } from './shared/scene-loader.js';
import type { SplatData } from './shared/types.js';
// ★ M4-P2.3: WGSL Shader 注入工具
import {
  injectWgslAfterMainBegin,
  injectWgslBeforeMainEnd,
  injectWgslBeforePattern,
} from './wgsl-shader-utils.js';
// ★ TD-05: WGSL 渲染着色器独立成文件
import { SPLAT_RENDER_SHADER } from './wgsl/splat-render-shader.js';
// ★ TD-09: WebGPU 空间分块视锥裁剪 (非 Morton 数据)
import { SplatGridCuller } from './splat-grid-culler.js';
// ★ R-06: 共享统计聚合
import { computeRenderStats } from './shared/stats.js';
import type { RenderStats } from '@3dgs/core';
import type { WebGPUCapability } from './webgpu-detector.js';
import * as THREE from 'three';

/** ★ TD-01: SH degree → 每通道非 DC 系数数 (uniform shDim 用, 0 = 无 SH) */
const SH_DIM_FOR_UNIFORM: Record<number, number> = { 0: 0, 1: 3, 2: 8, 3: 15 };

/** WebGPU 渲染管理器选项 */
export interface WebGPURenderManagerOptions {
  /** 强制设备分级 (默认自动检测) */
  deviceTier?: DeviceTier;
  /** 像素比覆盖 */
  pixelRatio?: number;
  /** 初始分辨率缩放比 */
  resolutionScale?: number;
  /** 是否启用自适应分辨率 (默认 true) */
  adaptiveResolution?: boolean;
  /** 清除色 */
  clearColor?: number;
  /** 是否启用键盘移动控制 (默认 true) */
  enableKeyboardControls?: boolean;
  /** 键盘移动速度 */
  moveSpeed?: number;
  /** 键盘升降速度 */
  verticalSpeed?: number;
  /** 是否加载后垂直翻转 (默认 true) */
  autoOrient?: boolean;
  /** 是否启用 GPU 排序 (默认 true, WebGPU 可用时) */
  enableGpuSort?: boolean;
  /** 是否启用 LOD (默认 true) */
  enableLod?: boolean;
}

/** Splat 数据格式 (SoA) — 定义移至 shared/types.ts (★ TD-05) */

/**
 * ★ D-01 纯函数: 合并"全量有序索引"与"可见位图" → 绘制索引 = 有序 ∩ 可见。
 *
 * 提取为独立函数便于单元测试 (不依赖 GPU 设备)。
 *
 * @param sorted 排序产出的全量有序索引 (可为 null — 首次排序完成前)
 * @param mask 裁剪产出的可见位图 (1=可见, 可为 null — 裁剪未执行)
 * @param count splat 总数
 * @param out 输出数组 (容量 >= count, 复用避免分配)
 * @param cullEnabled 裁剪是否启用 (关闭时直接采用排序/自然顺序)
 * @returns 可见数量 (draw 调用数)
 */
export function mergeSortedVisibleIndices(
  sorted: Uint32Array | null,
  mask: Uint8Array | null,
  count: number,
  out: Uint32Array,
  cullEnabled: boolean,
): number {
  let n = 0;

  if (cullEnabled && mask) {
    if (sorted && sorted.length >= count) {
      // 正常路径: 按排序顺序过滤出可见项 (保持 back-to-front 顺序)
      for (let i = 0; i < count; i++) {
        const idx = sorted[i];
        if (mask[idx]) out[n++] = idx;
      }
    } else {
      // 首次排序完成前: 按自然顺序过滤 (顺序未排序但裁剪已生效)
      for (let i = 0; i < count; i++) {
        if (mask[i]) out[n++] = i;
      }
    }
  } else {
    // 裁剪关闭: 直接采用排序结果 (或自然顺序)
    if (sorted && sorted.length >= count) {
      out.set(sorted.subarray(0, count));
    } else {
      for (let i = 0; i < count; i++) out[i] = i;
    }
    n = count;
  }

  return n;
}

/**
 * WebGPURenderManager — WebGPU 原生 3DGS 渲染器
 *
 * ⚠️ **@experimental** — 此渲染器尚未经过完整验证, 不建议在生产环境使用。
 * 当前实际渲染走 RenderManager (WebGL2 + Spark) 路径。
 * 与 RenderManager 存在功能重复 (键盘移动、自适应分辨率、拖拽控制),
 * 后续应提取共享基类或标记为实验性功能。
 *
 * 实现 RendererAdapter 接口, 使用 WebGPU 进行渲染。
 *
 * 使用方式:
 * ```typescript
 * const renderer = new WebGPURenderManager();
 * await renderer.init();
 * renderer.mount(container);
 * renderer.start();
 * await renderer.loadScene('/scene.splat');
 * ```
 */
export class WebGPURenderManager implements RendererAdapter {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;

  private deviceProfile: DeviceProfile;
  private tierSettings: ReturnType<typeof getTierSettings>;
  private adaptive?: AdaptiveResolution;
  private resolutionScale: number;
  private _pixelRatio: number;

  // Splat 数据
  private splatData: SplatData | null = null;
  private splatBuffers: {
    position: GPUBuffer | null;
    scale: GPUBuffer | null;
    color: GPUBuffer | null;
    rotation: GPUBuffer | null;
    index: GPUBuffer | null;
    /** ★ TD-01: 球谐非 DC 系数 storage buffer (无 SH 时为 null) */
    sh: GPUBuffer | null;
  } = {
    position: null,
    scale: null,
    color: null,
    rotation: null,
    index: null,
    sh: null,
  };

  // 渲染管线
  private renderPipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private depthTexture: GPUTexture | null = null;

  // 排序
  private sortManager: WebGPUSortManager | null = null;
  private enableGpuSort: boolean;
  private _enableLod: boolean;
  private _autoOrient: boolean;
  private _lodReady = false;
  private _lastSortResult: SortResult | null = null;

  // 相机
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: DragLookControls | null = null;

  // 渲染状态
  private _running = false;
  private _destroyed = false;
  private rafId = 0;
  private _lastFrameTime = 0;
  private _smoothDt = 16.67;

  // 尺寸
  private cssWidth = 0;
  private cssHeight = 0;
  private renderWidth = 0;
  private renderHeight = 0;

  // ★ M4: 共享模块实例
  private _frameCallbacks = new FrameCallbackManager();
  private _cameraCache = new CameraMatrixCache();
  private _keyboard: KeyboardControls;

  // Shader 注入 (与 RenderManager 兼容)
  private _shaderInjections = new Map<string, ShaderInjection>();
  private _injectionUniforms = new Map<string, Record<string, unknown>>();

  // ★ M4-P2.2: SOG 流式加载器 (用于 abort)
  private _sogStreamer?: SogStreamer;
  /** ★ M4-P2.2: 预构建 SOG LOD 层级 */
  private _sogLodLevels?: number[];
  /** ★ M4-P2.2: LOD 缩减因子 */
  private _sogLodBase?: number;

  // 排序节流
  private _lastSortTime = 0;
  private _sortIntervalMs: number;
  // ★ 并发排序保护: 防止多个 sort 重叠执行
  private _sorting = false;

  // ★ 视锥裁剪
  private _frustum = new THREE.Frustum();
  private _visibleCount = 0;
  private _frustumCullEnabled = true;
  private _frustumUpdateInterval = 3; // 每 3 帧更新一次视锥
  private _frustumFrameCounter = 0;
  // ★ §2.6: 复用投影屏幕矩阵, 消除每 3 帧分配 THREE.Matrix4
  private _tmpProjScreen = new THREE.Matrix4();
  // ★ D-01 单一索引管线: 排序产出全量有序索引 (_lastSortResult),
  //   裁剪产出可见位图 (_visibleMask), 合并后仅写入一次 GPU index buffer
  private _visibleMask: Uint8Array | null = null;
  private _drawIndices: Uint32Array | null = null;
  // ★ TD-09: 空间分块裁剪器 (惰性构建, 场景数据变更时重建)
  private _gridCuller: SplatGridCuller | null = null;
  private _gridCullerCount = 0;
  // ★ TD-09: 上次裁剪结果 — 未变化时跳过 CPU→GPU index 回写
  private _lastVisibleMask: Uint8Array | null = null;
  // ★ N-01: 页面可见性暂停 (移动端省电)
  private _visibilityHandler?: () => void;
  private _wasRunningBeforeHide = false;

  // ★ TD-03: 预取缓存 — preloadScene 下载的资源, loadScene 命中后不再重复 fetch
  private _preloadCache = new Map<string, Uint8Array>();
  // ★ 复用 uniform ArrayBuffer, 消除每帧分配
  // ★ M4-P2.1: 扩展为 192 字节 (VP 64 + view 64 + camPos 16 + focal 8 + splatCount 4 + time 4 + pad 8 = 168 → 176 对齐, 取 192 留余量)
  private _uniformData = new ArrayBuffer(192);
  private _uniformView = new DataView(this._uniformData);
  // ★ GPU 设备丢失标志
  private _deviceLost = false;

  // 格式配置
  private format: GPUTextureFormat;

  constructor(options: WebGPURenderManagerOptions = {}) {
    // ★ M3: 标记 experimental — 提醒开发者此渲染器未经验证
    console.warn(
      '[WebGPURenderManager] ⚠️ experimental — 此渲染器尚未经过完整验证, 不建议在生产环境使用。' +
        ' 当前实际渲染走 RenderManager (WebGL2 + Spark) 路径。',
    );

    this.deviceProfile = detectDeviceTier();
    const tier = options.deviceTier ?? this.deviceProfile.tier;
    this.tierSettings = getTierSettings(tier);

    this.resolutionScale = options.resolutionScale ?? this.tierSettings.resolutionScale;
    this._pixelRatio = options.pixelRatio ?? this.tierSettings.pixelRatio;
    this._keyboard = new KeyboardControls({
      moveSpeed: options.moveSpeed ?? 5.0,
      verticalSpeed: options.verticalSpeed ?? 3.0,
      enabled: options.enableKeyboardControls ?? true,
    });
    this._autoOrient = options.autoOrient ?? true;
    this._enableLod = options.enableLod ?? true;
    this.enableGpuSort = options.enableGpuSort ?? true;
    this._sortIntervalMs = this.tierSettings.minSortIntervalMs;
    // ★ 不硬编码 format, 在 init() 中从 GPU 获取首选格式
    this.format = 'bgra8unorm'; // 默认值, init() 会覆盖

    if (options.adaptiveResolution !== false) {
      this.adaptive = new AdaptiveResolution(this.resolutionScale, (scale) =>
        this.onResolutionChanged(scale),
      );
    }
  }

  /**
   * 初始化 WebGPU 设备
   *
   * 必须在 mount() 之前调用。
   *
   * ★ 兼容性: 使用 requiredLimits 确保最低能力, 从 GPU 获取首选画布格式
   */
  async init(): Promise<void> {
    if (!('gpu' in navigator)) {
      throw new Error('WebGPU 不可用: navigator.gpu 不存在');
    }

    const gpu = (navigator as unknown as { gpu: GPU }).gpu;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      throw new Error('WebGPU 不可用: 无法获取 GPU 适配器');
    }

    // ★ 检测回退适配器 (软件渲染)
    const isFallback = Boolean(
      (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter,
    );
    // ★ 某些浏览器 (如 Chrome headless) 不设 isFallbackAdapter=true,
    //   需要从 adapter.info 的 vendor/architecture 中检测 SwiftShader/LLVMpipe
    let adapterVendor = '';
    let adapterArch = '';
    try {
      const info = (adapter as unknown as { info?: { vendor: string; architecture: string } }).info;
      if (info) {
        adapterVendor = (info.vendor || '').toLowerCase();
        adapterArch = (info.architecture || '').toLowerCase();
      }
    } catch {
      /* 旧版浏览器可能不支持 adapter.info */
    }
    const isSoftwareRenderer =
      isFallback ||
      adapterVendor.includes('swiftshader') ||
      adapterArch.includes('swiftshader') ||
      adapterVendor.includes('llvmpipe') ||
      adapterArch.includes('llvmpipe');
    if (isSoftwareRenderer) {
      throw new Error(
        'WebGPU 使用软件渲染 (SwiftShader/LLVMpipe), 性能不足以进行 3DGS 渲染, 请使用 WebGL2 后端',
      );
    }

    // ★ 请求设备, 声明所需最低限制
    // maxBufferSize >= 128MB (至少 ~4M splats)
    // maxBindGroups >= 2 (当前管线使用 1 个)
    // maxStorageBuffersPerShaderStage >= 6 (position, scale, color, rotation, index + uniform)
    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: 128 * 1024 * 1024, // 128 MB
        maxBindGroups: 2,
        maxStorageBuffersPerShaderStage: 6,
        maxComputeWorkgroupsPerDimension: 65535,
      },
    });

    this.device.lost.then((info) => {
      console.error('[WebGPURenderManager] GPU 设备丢失:', info.message);
      this._deviceLost = true;
      this._running = false;
    });

    // ★ 从 GPU 获取首选画布格式 (跨平台兼容: bgra8unorm / rgba8unorm)
    this.format = gpu.getPreferredCanvasFormat();

    // 初始化 GPU 排序管理器
    if (this.enableGpuSort) {
      this.sortManager = new WebGPUSortManager({ device: this.device });
      await this.sortManager.init();
    }

    // ★ 根据 GPU 限制调整 maxSplats
    this.adjustForGpuLimits();

    console.info(
      `[WebGPURenderManager] WebGPU 设备初始化完成 | format: ${this.format} | ` +
        `maxBufferSize: ${(this.device.limits.maxBufferSize / 1024 / 1024).toFixed(0)}MB | ` +
        `maxSplats: ${this.tierSettings.maxSplats.toLocaleString()}`,
    );
  }

  /**
   * ★ 根据 GPU 实际限制调整渲染参数 (跨机型兼容)
   *
   * 检查 maxBufferSize 是否能容纳当前 maxSplats, 如果不够则自动降采样
   */
  private adjustForGpuLimits(): void {
    if (!this.device) return;

    const maxBufferSize = this.device.limits.maxBufferSize;
    // 每个 splat 需要: position(12) + scale(12) + color(4) + rotation(4) + index(4) = 36 bytes
    // 加上 sort manager 的 position(12) + distance(4) + index(4) = 20 bytes
    // 总计 ~56 bytes/splat, 取 64 bytes 作为安全估计
    const bytesPerSplat = 64;
    const maxSplatsByBuffer = Math.floor(maxBufferSize / bytesPerSplat);

    if (this.tierSettings.maxSplats > maxSplatsByBuffer) {
      const oldMax = this.tierSettings.maxSplats;
      this.tierSettings = { ...this.tierSettings, maxSplats: maxSplatsByBuffer };
      console.warn(
        `[WebGPURenderManager] GPU maxBufferSize 限制: maxSplats ${oldMax.toLocaleString()} → ${maxSplatsByBuffer.toLocaleString()}`,
      );
    }

    // ★ 检查 maxStorageBufferBindingSize
    const maxBinding = this.device.limits.maxStorageBufferBindingSize;
    const maxSplatsByBinding = Math.floor(maxBinding / bytesPerSplat);
    if (this.tierSettings.maxSplats > maxSplatsByBinding) {
      const oldMax = this.tierSettings.maxSplats;
      this.tierSettings = { ...this.tierSettings, maxSplats: maxSplatsByBinding };
      console.warn(
        `[WebGPURenderManager] GPU maxStorageBufferBindingSize 限制: maxSplats ${oldMax.toLocaleString()} → ${maxSplatsByBinding.toLocaleString()}`,
      );
    }
  }

  /**
   * ★ 应用 WebGPU 能力检测结果 (跨机型兼容)
   *
   * 在 init() 之后调用, 根据检测到的 GPU 类型调整渲染参数。
   *
   * @param capability detectWebGPU() 返回的能力检测结果
   */
  applyCapability(capability: WebGPUCapability): void {
    if (!capability.supported || !capability.gpuType) return;

    // 根据 GPU 类型调整参数
    if (
      capability.recommendedMaxSplats &&
      capability.recommendedMaxSplats < this.tierSettings.maxSplats
    ) {
      const oldMax = this.tierSettings.maxSplats;
      this.tierSettings = { ...this.tierSettings, maxSplats: capability.recommendedMaxSplats };
      console.info(
        `[WebGPURenderManager] GPU 类型 ${capability.gpuType}: maxSplats ${oldMax.toLocaleString()} → ${capability.recommendedMaxSplats.toLocaleString()}`,
      );
    }

    if (
      capability.recommendedResolutionScale &&
      capability.recommendedResolutionScale < this.resolutionScale
    ) {
      this.resolutionScale = capability.recommendedResolutionScale;
      this.adaptive?.setScale(this.resolutionScale);
      console.info(
        `[WebGPURenderManager] GPU 类型 ${capability.gpuType}: resolutionScale → ${this.resolutionScale}`,
      );
    }

    if (
      capability.recommendedSortIntervalMs &&
      capability.recommendedSortIntervalMs > this._sortIntervalMs
    ) {
      this._sortIntervalMs = capability.recommendedSortIntervalMs;
      console.info(
        `[WebGPURenderManager] GPU 类型 ${capability.gpuType}: sortIntervalMs → ${this._sortIntervalMs}`,
      );
    }

    // 日志: GPU 信息
    if (capability.adapterInfo) {
      const gpuInfo = `${capability.adapterInfo.vendor} ${capability.adapterInfo.architecture}`;
      const tc = capability.textureCompression;
      const tcStr = tc
        ? `BC:${tc.bc ? '✓' : '✗'} ETC2:${tc.etc2 ? '✓' : '✗'} ASTC:${tc.astc ? '✓' : '✗'}`
        : 'N/A';
      console.info(
        `[WebGPURenderManager] GPU: ${gpuInfo} | 类型: ${capability.gpuType} | 纹理压缩: ${tcStr}`,
      );
    }
  }

  // ─── RendererAdapter 实现 ────────────────────────────────

  mount(container: HTMLElement): void {
    this.container = container;
  }

  start(): void {
    if (!this.container || this._running || !this.device) return;

    const rect = this.container.getBoundingClientRect();
    this.cssWidth = rect.width || window.innerWidth;
    this.cssHeight = rect.height || window.innerHeight;

    // 创建 canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cssWidth;
    this.canvas.height = this.cssHeight;
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
    });
    this.container.appendChild(this.canvas);

    // 获取 WebGPU canvas 上下文
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('无法获取 WebGPU canvas 上下文');
    }

    // 配置 canvas 格式
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(60, this.cssWidth / this.cssHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 0);

    // 创建控制器 — 与 RenderManager 一致
    this.controls = new DragLookControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.003;
    this.controls.wheelSpeed = 0.5;

    // 创建 uniform buffer
    // ★ M4-P2.1: 扩展为 192 字节, 新增 viewMatrix (64B) 和 focal (8B)
    this.uniformBuffer = this.device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.updateRenderSize();

    if (this._keyboard.isEnabled) {
      this._keyboard.setup();
    }

    this._running = true;
    this._lastFrameTime = performance.now();
    this.renderLoop();

    // ★ N-01: 页面隐藏时暂停渲染循环 (移动端切后台省电, PC 多标签省 CPU)
    if (typeof document !== 'undefined') {
      this._visibilityHandler = () => {
        if (this._destroyed) return;
        if (document.hidden) {
          if (this._running) {
            this._wasRunningBeforeHide = true;
            this.stop();
            this.adaptive?.suspend();
          }
        } else if (this._wasRunningBeforeHide) {
          this._wasRunningBeforeHide = false;
          this.adaptive?.resume();
          this._running = true;
          // 重置时间基准, 防止隐藏期间产生巨大 dt 尖峰
          this._lastFrameTime = performance.now();
          this.renderLoop();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  stop(): void {
    this._running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** ★ TD-03/R-05: 预加载场景资源 — 下载并缓存字节, loadScene 命中后不重复 fetch */
  async preloadScene(source: string): Promise<void> {
    if (!source) return;
    // 已预取或流式资源 (SOG 无需预取) 时跳过
    if (this._preloadCache.has(source) || source.endsWith('.sog')) return;
    const data = await fetchWithProgress(source);
    this._preloadCache.set(source, data);
    // ★ 缓存上限: 避免长期会话累积内存 (LRU 淘汰最旧条目)
    const MAX_PRELOAD_ENTRIES = 16;
    while (this._preloadCache.size > MAX_PRELOAD_ENTRIES) {
      const oldest = this._preloadCache.keys().next().value;
      if (oldest === undefined) break;
      this._preloadCache.delete(oldest);
    }
  }

  async loadScene(source: string, options?: LoadOptions): Promise<void> {
    if (!this.device) throw new Error('WebGPURenderManager 未初始化');

    // ★ M4-P2.2: 中止之前的 SOG 流式加载
    this._sogStreamer?.abort();
    this._sogStreamer = undefined;
    this._sogLodLevels = undefined;
    this._sogLodBase = undefined;

    // ★ §2.5/N-06: 加载期间暂停自适应分辨率, 防止低帧率误降分辨率;
    //   finally 确保任何分支 (含提前 return 与异常) 都恢复采样
    this.adaptive?.suspend();
    try {
      // ★ M4-P2.2: 若提供 lodSource (SOG 流式 LOD URL), 优先使用
      if (options?.lodSource) {
        try {
          await this.loadSceneWithSog(options.lodSource, options);
          return;
        } catch (err) {
          console.warn(
            '[WebGPURenderManager] SOG 流式加载失败, 回退到 source 直接加载:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      // ★ M4-P2.2: SPZ 格式 — Worker 解码
      if (source.endsWith('.spz')) {
        try {
          await this.loadSceneWithSpz(source, options);
          return;
        } catch (err) {
          console.warn('[WebGPURenderManager] SPZ 解码失败, 回退到 .splat 直接加载:', err);
        }
      }

      // ★ M4-P2.2: SOG 格式 — 流式分块加载
      if (source.endsWith('.sog')) {
        try {
          await this.loadSceneWithSog(source, options);
          return;
        } catch (err) {
          console.warn('[WebGPURenderManager] SOG 加载失败, 回退到 .splat 直接加载:', err);
        }
      }

      // 默认: .splat 格式 (fetch + parseSplatData)
      await this.loadSceneWithSplat(source, options);
    } finally {
      // ★ §2.5/N-06: 加载结束恢复自适应分辨率采样
      this.adaptive?.resume();
    }
  }

  /**
   * ★ M4-P2.2: 加载 .splat 格式 (32 bytes/splat)
   *
   * 支持流式读取 + 进度回调, 与原有 loadScene 逻辑一致。
   */
  private async loadSceneWithSplat(source: string, options?: LoadOptions): Promise<void> {
    // ★ TD-08: 统一使用共享 fetchWithProgress (reader 分块 + 进度回调)
    // ★ TD-03: preloadScene 预取命中时直接复用, 不重复下载
    const cached = this._preloadCache.get(source);
    const fullData =
      cached ??
      (await fetchWithProgress(source, {
        onProgress: options?.onProgress,
      }));

    const splatData = this.parseSplatData(fullData);
    await this.processSplatData(splatData, options);
  }

  /**
   * ★ M4-P2.2: 加载 .spz 格式 — Worker 解码 → .splat 格式
   *
   * 工作流程:
   *   1. fetch 获取 SPZ 文件 (支持进度回调)
   *   2. decodeSpzInWorker: gzip 解压 + 反量化 → .splat 格式字节
   *   3. parseSplatData → processSplatData (降采样 + GPU 上传)
   *
   * [来源: SPZ 格式 — github.com/nianticlabs/spz]
   * [来源: 项目源码 — packages/renderer-three/src/spz-decoder-worker.ts]
   */
  private async loadSceneWithSpz(source: string, options?: LoadOptions): Promise<void> {
    // ★ TD-08: 统一使用共享 fetchWithProgress (reader 分块 + 进度回调)
    // ★ TD-03: preloadScene 预取命中时直接复用, 不重复下载
    const cached = this._preloadCache.get(source);
    const spzData =
      cached ??
      (await fetchWithProgress(source, {
        onProgress: options?.onProgress,
      }));

    // ★ TD-01: 直接解码为 SoA SplatData (保留 SH 球谐系数), 不再经过 .splat 中间格式
    //   旧路径: SPZ → decodeSpzInWorker → .splat (SH 被丢弃) → parseSplatData
    //   新路径: SPZ → decodeSpzToSplatData (SH 保留)
    const splatData = await decodeSpzToSplatData(
      spzData.buffer.slice(
        spzData.byteOffset,
        spzData.byteOffset + spzData.byteLength,
      ) as ArrayBuffer,
    );
    await this.processSplatData(splatData, options);

    console.info(`[WebGPURenderManager] SPZ 加载完成: ${splatData.count.toLocaleString()} splats`);
  }

  /**
   * ★ M4-P2.2: 加载 .sog 格式 — SogStreamer 流式分块加载
   *
   * 工作流程:
   *   1. SogStreamer 并行加载所有 chunk (HTTP Range 请求, 4 路并行)
   *   2. 使用 concatChunksInWorker 在 Worker 中拼接为完整 buffer
   *   3. parseSplatData → processSplatData (降采样 + GPU 上传)
   *   4. 缓存 LOD 元数据 (lodLevels, lodBase) 供未来使用
   *
   * [来源: SogStreamer — packages/renderer-three/src/sog-streamer.ts]
   * [来源: SOG 格式 — packages/convert/src/sog-writer.ts]
   */
  private async loadSceneWithSog(source: string, options?: LoadOptions): Promise<void> {
    // ★ TD-08: 统一使用共享 loadSogChunks (SogStreamer + concatChunksInWorker)
    const { fullData, metadata, streamer } = await loadSogChunks(
      source,
      this.tierSettings.maxSplats,
      {
        onProgress: (loaded, total) => {
          options?.onProgress?.(loaded, total);
        },
        onError: (error) => {
          console.error('[WebGPURenderManager] SOG chunk 加载错误:', error.message);
        },
      },
    );
    this._sogStreamer = streamer;

    // 缓存 LOD 元数据
    if (metadata.lodLevels && metadata.lodLevels.length > 0) {
      this._sogLodLevels = metadata.lodLevels;
      this._sogLodBase = metadata.lodBase;
      console.info(
        `[WebGPURenderManager] 预构建 LOD: ${metadata.lodLevels.length} 层, base=${metadata.lodBase?.toFixed(2) ?? '?'}`,
      );
    }

    // 解析为 SplatData (降采样在 processSplatData 中处理)
    const splatData = this.parseSplatData(fullData);
    await this.processSplatData(splatData, options);

    const compressionStr = metadata.compression === 1 ? 'gzip' : 'none';
    console.info(
      `[WebGPURenderManager] SOG 加载完成: ${metadata.numSplats.toLocaleString()} splats, ` +
        `${metadata.numChunks} chunks, compression=${compressionStr}, v${metadata.version}`,
    );
  }

  /** 处理解析后的 splat 数据: 降采样 + 上传 GPU + 定位相机 */
  private async processSplatData(splatData: SplatData, options?: LoadOptions): Promise<void> {
    // 降采样: 使用 tierSettings.maxSplats (与 RenderManager 一致)
    const maxSplats = this.tierSettings.maxSplats;
    if (splatData.count > maxSplats) {
      this.splatData = downsampleSplatData(splatData, maxSplats);
      console.info(
        `[WebGPURenderManager] 降采样: ${this.splatData.count.toLocaleString()} / ${splatData.count.toLocaleString()} splats`,
      );
    } else {
      this.splatData = splatData;
    }

    // ★ D-09: 坐标系翻转 — 翻转数据而非相机 (与 RenderManager "翻转 mesh" 策略一致)。
    //   旧实现在 positionCameraToBounds() 的 lookAt 之后再 camera.rotation.x = Math.PI,
    //   直接覆盖 lookAt 结果导致初始视角不可预期; 改为上传前对 positions 的 y 取反。
    if (this._autoOrient) {
      const pos = this.splatData.positions;
      for (let i = 1; i < pos.length; i += 3) {
        pos[i] = -pos[i];
      }
    }

    // ★ D-01: 场景数据变更 — 旧排序结果/可见位图对新数据无效, 重置索引管线状态;
    //   index buffer 已由 uploadSplatData 初始化为自然顺序, 首次裁剪/排序后自动收敛
    // ★ TD-09: 空间分块裁剪器基于旧数据, 必须一并重建
    this._lastSortResult = null;
    this._visibleMask = null;
    this._lastVisibleMask = null;
    this._gridCuller = null;
    this._gridCullerCount = 0;
    this._visibleCount = this.splatData.count;

    if (options?.onProgress) {
      options.onProgress(this.splatData.count, this.splatData.count);
    }

    // 上传到 GPU
    this.uploadSplatData();

    // 创建渲染管线
    this.createRenderPipeline();

    // 上传到排序管理器
    if (this.sortManager && this.splatData) {
      this.sortManager.uploadPositions(this.splatData.positions);
    }

    // 自动定位相机 (★ D-09: lookAt 结果即为最终朝向, 不再被相机翻转覆盖)
    if (this.camera && this.splatData) {
      this.positionCameraToBounds();
    }

    // ★ 初始化视锥裁剪
    this.updateFrustum();
    this.performFrustumCull();

    console.info(
      `[WebGPURenderManager] 场景加载完成: ${this.splatData.count.toLocaleString()} splats` +
        (this._frustumCullEnabled ? `, 可见: ${this._visibleCount.toLocaleString()}` : ''),
    );
  }

  getViewProjectionMatrix(): Float32Array {
    return this._cameraCache.vpMatrix;
  }

  getCameraPosition(): { x: number; y: number; z: number } {
    return this._cameraCache.camPos;
  }

  getSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  getDeviceTier(): DeviceTier {
    return this.deviceProfile.tier;
  }

  setResolutionScale(scale: number): void {
    this.resolutionScale = scale;
    this.adaptive?.setScale(scale);
    this.updateRenderSize();
  }

  onFrame(callback: (deltaTime: number) => void): () => void {
    return this._frameCallbacks.onFrame(callback);
  }

  addShaderInjection(injection: ShaderInjection): void {
    if (this._shaderInjections.has(injection.id)) {
      console.warn(`[WebGPURenderManager] Shader 注入 '${injection.id}' 已存在, 将被覆盖`);
      this.removeShaderInjection(injection.id);
    }
    this._shaderInjections.set(injection.id, injection);
    const uniforms: Record<string, unknown> = {};
    if (injection.uniforms) {
      for (const [key, value] of Object.entries(injection.uniforms)) {
        uniforms[key] = value;
      }
    }
    this._injectionUniforms.set(injection.id, uniforms);
    // ★ M4-P2.3: 重建管线以应用注入的 WGSL 代码
    if (this.renderPipeline && this.device && this.splatData) {
      this.createRenderPipeline();
    }
  }

  removeShaderInjection(id: string): void {
    this._shaderInjections.delete(id);
    this._injectionUniforms.delete(id);
    // ★ M4-P2.3: 重建管线以移除注入的 WGSL 代码
    if (this.renderPipeline && this.device && this.splatData) {
      this.createRenderPipeline();
    }
  }

  destroy(): void {
    this.stop();
    this._keyboard.teardown();
    this._sorting = false;

    // ★ N-01: 注销可见性监听, 避免泄漏与销毁后回调
    if (this._visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = undefined;
    }

    // ★ M4-P2.2: 中止 SOG 流式加载
    this._sogStreamer?.abort();
    this._sogStreamer = undefined;
    // ★ TD-03: 清理预取缓存
    this._preloadCache.clear();

    // 释放 GPU 资源
    this.splatBuffers.position?.destroy();
    this.splatBuffers.scale?.destroy();
    this.splatBuffers.color?.destroy();
    this.splatBuffers.rotation?.destroy();
    this.splatBuffers.index?.destroy();
    this.splatBuffers.sh?.destroy();
    this.splatBuffers = {
      position: null,
      scale: null,
      color: null,
      rotation: null,
      index: null,
      sh: null,
    };

    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.sortManager?.dispose();
    this.controls?.dispose();

    this.canvas?.remove();
    this.device?.destroy();

    this._frameCallbacks.clear();
    this._destroyed = true;
  }

  // ─── 访问器 ──────────────────────────────────────────────

  getDeviceProfile(): DeviceProfile {
    return this.deviceProfile;
  }

  getResolutionScale(): number {
    return this.adaptive?.currentResolutionScale ?? this.resolutionScale;
  }

  // ★ R-06: 渲染统计 (帧时间/可见数/分辨率; WebGPU 无 BufferPool, 池统计为 0)
  getStats(): RenderStats {
    return computeRenderStats({
      smoothDt: this._smoothDt,
      visibleSplats: this._frustumCullEnabled ? this._visibleCount : (this.splatData?.count ?? 0),
      resolutionScale: this.getResolutionScale(),
      renderWidth: this.renderWidth,
      renderHeight: this.renderHeight,
    });
  }

  isLodReady(): boolean {
    return this._lodReady;
  }

  /** 获取 GPU 排序管理器 */
  getSortManager(): WebGPUSortManager | null {
    return this.sortManager;
  }

  /** 获取最后排序结果 */
  getLastSortResult(): SortResult | null {
    return this._lastSortResult;
  }

  /** ★ M4-P2.2: 获取预构建 SOG LOD 层级 */
  getSogLodLevels(): number[] | undefined {
    return this._sogLodLevels;
  }

  /** ★ M4-P2.2: 获取 LOD 缩减因子 */
  getSogLodBase(): number | undefined {
    return this._sogLodBase;
  }

  // ─── 键盘控制 (★ M4: 委托共享模块) ──────────────────────

  setKeyboardEnabled(enabled: boolean): void {
    if (enabled) {
      if (this._running) this._keyboard.setup();
    } else {
      this._keyboard.teardown();
    }
  }

  setMoveSpeed(speed: number): void {
    this._keyboard.setMoveSpeed(speed);
  }

  setVerticalSpeed(speed: number): void {
    this._keyboard.setVerticalSpeed(speed);
  }

  getActiveMoveKeys(): string[] {
    return this._keyboard.getActiveMoveKeys();
  }

  // ─── 内部方法 ────────────────────────────────────────────

  private renderLoop = (): void => {
    if (!this._running || this._destroyed || this._deviceLost) return;
    this.rafId = requestAnimationFrame(this.renderLoop);

    const now = performance.now();
    const rawDt = now - this._lastFrameTime;
    this._lastFrameTime = now;

    // ★ 连续指数平滑 dt (与 RenderManager 一致)
    this._smoothDt = this._smoothDt * 0.9 + rawDt * 0.1;
    const dt = Math.min(this._smoothDt, 50);

    // 更新控制器
    this.controls?.update();

    // 更新键盘移动 (★ M4: 共享模块)
    if (this.camera) {
      this._keyboard.applyMovement(this.camera, dt);
    }

    // 更新相机矩阵 (★ M4: 共享模块)
    this.updateCameraMatrix();

    // ★ 视锥裁剪 (每 N 帧更新一次)
    this._frustumFrameCounter++;
    if (this._frustumFrameCounter >= this._frustumUpdateInterval) {
      this._frustumFrameCounter = 0;
      this.updateFrustum();
      this.performFrustumCull();
    }

    // GPU 排序 (节流 + ★ 并发保护 + ★ 设备丢失守卫)
    if (
      this.splatData &&
      this.sortManager &&
      this.enableGpuSort &&
      !this._sorting &&
      !this._deviceLost &&
      !this._destroyed
    ) {
      if (now - this._lastSortTime > this._sortIntervalMs) {
        this._lastSortTime = now;
        this._sorting = true;
        this.sortManager
          .sort(this._cameraCache.camPos.x, this._cameraCache.camPos.y, this._cameraCache.camPos.z)
          .then((result) => {
            this._sorting = false;
            // ★ 设备已销毁或丢失时, 不再写入 buffer
            if (this._destroyed || this._deviceLost) return;
            this._lastSortResult = result;
            // ★ D-01: 不直接写 index buffer, 而是与可见位图合并后统一写入,
            //   避免排序结果被裁剪结果覆盖 (或反之) 导致排序/裁剪双双失效
            this.mergeAndUploadIndices();
          })
          .catch((err) => {
            this._sorting = false;
            // ★ 设备已销毁或丢失时, 静默处理 (不打印警告)
            if (this._destroyed || this._deviceLost) return;
            console.warn('[WebGPURenderManager] GPU 排序失败:', err);
          });
      }
    }

    // 渲染
    this.render();

    // 帧回调 (★ M4: 共享模块)
    this._frameCallbacks.invoke(dt);

    // ★ M4-P2.3: 更新 injection uniforms (调用 onUpdate 回调)
    this.updateInjectionUniforms(dt);

    // 自适应分辨率 (使用 sample(), 与 RenderManager 一致)
    this.adaptive?.sample();
  };

  private render(): void {
    if (
      !this.device ||
      !this.context ||
      !this.renderPipeline ||
      !this.splatData ||
      this._deviceLost
    )
      return;

    const encoder = this.device.createCommandEncoder();

    // 创建 depth texture (如果尺寸变化)
    this.ensureDepthTexture();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.067, g: 0.067, b: 0.067, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.bindGroup);
    // ★ 使用视锥裁剪后的可见 splat 数量
    const drawCount = this._frustumCullEnabled ? this._visibleCount : this.splatData.count;
    pass.draw(6, drawCount); // 每个 splat 用 6 个顶点 (两个三角形构成 quad)
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  /** 更新相机矩阵 (★ M4: 使用 CameraMatrixCache 共享模块, ★ M4-P2.1: 写入 viewMatrix + focal) */
  private updateCameraMatrix(): void {
    if (!this.camera) return;

    // 使用共享模块更新 VP 矩阵和相机坐标
    this._cameraCache.update(this.camera);

    // 更新 uniform buffer (★ 复用 _uniformData, 消除每帧 ArrayBuffer 分配)
    // ★ M4-P2.1: 新增 viewMatrix (offset 64) 和 focal (offset 144)
    if (this.device && this.uniformBuffer && !this._deviceLost) {
      const view = this._uniformView;

      // VP matrix (16 × Float32 = 64 bytes, offset 0)
      for (let i = 0; i < 16; i++) {
        view.setFloat32(i * 4, this._cameraCache.vpMatrix[i], true);
      }

      // ★ M4-P2.1: View matrix (16 × Float32 = 64 bytes, offset 64)
      // 用于在着色器中计算 view-space 协方差矩阵
      const viewMat = this.camera.matrixWorldInverse.elements;
      for (let i = 0; i < 16; i++) {
        view.setFloat32(64 + i * 4, viewMat[i], true);
      }

      // Camera position (vec4 = 16 bytes, offset 128, w unused)
      view.setFloat32(128, this._cameraCache.camPos.x, true);
      view.setFloat32(132, this._cameraCache.camPos.y, true);
      view.setFloat32(136, this._cameraCache.camPos.z, true);
      view.setFloat32(140, 0.0, true);

      // ★ M4-P2.1: Focal lengths (vec2 = 8 bytes, offset 144)
      // 从投影矩阵提取: fx = P[0][0], fy = P[1][1]
      const projMat = this.camera.projectionMatrix.elements;
      view.setFloat32(144, projMat[0], true); // fx
      view.setFloat32(148, projMat[5], true); // fy

      // Splat count (Uint32, at offset 152)
      view.setUint32(152, this.splatData?.count ?? 0, true);
      // Time (Float32, at offset 156)
      view.setFloat32(156, performance.now() / 1000, true);
      // ★ TD-01: shDim (Uint32, at offset 160) — SPZ SH 阶数对应系数数 0/3/8/15
      view.setUint32(160, SH_DIM_FOR_UNIFORM[this.splatData?.shDegree ?? 0] ?? 0, true);

      this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
  }

  /** 确保深度纹理存在且尺寸正确 */
  private ensureDepthTexture(): void {
    if (!this.device || !this.canvas) return;

    const width = this.renderWidth;
    const height = this.renderHeight;

    if (
      this.depthTexture &&
      this.depthTexture.width === width &&
      this.depthTexture.height === height
    ) {
      return;
    }

    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  // ★ 视锥裁剪方法 ─────────────────────────────────────────

  /** 更新视锥体 (★ §2.6: 复用 _tmpProjScreen, 消除每 3 帧分配) */
  private updateFrustum(): void {
    if (!this.camera) return;

    this._tmpProjScreen.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._tmpProjScreen);
  }

  /**
   * 执行视锥裁剪 (★ D-01: 产出可见位图, 不再直接写 index buffer)
   *
   * ★ TD-09: 使用空间分块裁剪器替代 O(N×6) 逐 splat 中心点测试:
   *   - 首帧惰性构建 8³ 网格 (O(N))
   *   - 每帧对 512 个 cell 做 bbox 相交测试, 命中 cell 遍历其成员置 1 (O(G + N_visible))
   *   - mask 未变化时跳过 mergeAndUploadIndices 的 CPU→GPU 回写
   */
  private performFrustumCull(): void {
    if (!this.splatData || !this._frustumCullEnabled) {
      this._visibleCount = this.splatData?.count ?? 0;
      return;
    }

    const positions = this.splatData.positions;
    const count = this.splatData.count;

    // 分配/复用可见位图 (1 byte/splat, 1M splats 仅 1MB)
    if (!this._visibleMask || this._visibleMask.length < count) {
      this._visibleMask = new Uint8Array(count);
    }

    // ★ TD-09: 惰性构建空间分块裁剪器 (positions 在 processSplatData 中已完成 D-09 y 翻转)
    if (!this._gridCuller || this._gridCullerCount !== count) {
      this._gridCuller = new SplatGridCuller(positions, count);
      this._gridCullerCount = count;
    }

    const mask = this._visibleMask;
    this._gridCuller.cull(this._frustum, mask);

    // ★ TD-09: mask 变更检测 — 未变化时跳过 index buffer 回写 (消除每 3 帧 N×4B 上传)
    // ★ 性能: 用 Uint32 视图批量比较 (4 字节/次), 尾部余数单独处理
    const last = this._lastVisibleMask;
    let changed = !last || last.length !== mask.length;
    if (!changed && mask.length > 0) {
      // 尽量 4 字节对齐比较; 非对齐时退回逐字节 (byteOffset 由 Uint8Array 决定)
      if (mask.byteOffset % 4 === 0 && last!.byteOffset % 4 === 0) {
        const wordCount = mask.length >> 2;
        const maskWords = new Uint32Array(mask.buffer, mask.byteOffset, wordCount);
        const lastWords = new Uint32Array(last!.buffer, last!.byteOffset, wordCount);
        for (let w = 0; w < wordCount; w++) {
          if (maskWords[w] !== lastWords[w]) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          for (let i = wordCount * 4; i < mask.length; i++) {
            if (mask[i] !== last![i]) {
              changed = true;
              break;
            }
          }
        }
      } else {
        for (let i = 0; i < mask.length; i++) {
          if (mask[i] !== last![i]) {
            changed = true;
            break;
          }
        }
      }
    }
    if (!this._lastVisibleMask || this._lastVisibleMask.length !== mask.length) {
      this._lastVisibleMask = new Uint8Array(mask.length);
    }
    this._lastVisibleMask.set(mask);

    if (changed) {
      this.mergeAndUploadIndices();
    }
  }

  /**
   * ★ D-01 单一索引管线合并步骤:
   *   drawIndices[0..visibleCount) = sortedIndices.filter(i => visibleMask[i])
   *
   * 由排序回调与裁剪更新共同触发 (取较晚发生者), 合并后仅写入一次 GPU,
   * draw 调用数 = visibleCount。
   */
  private mergeAndUploadIndices(): void {
    if (!this.device || !this.splatBuffers.index || !this.splatData || this._deviceLost) return;

    const count = this.splatData.count;
    if (count === 0) return;

    if (!this._drawIndices || this._drawIndices.length < count) {
      this._drawIndices = new Uint32Array(count);
    }

    const n = mergeSortedVisibleIndices(
      this._lastSortResult?.indices ?? null,
      this._visibleMask,
      count,
      this._drawIndices,
      this._frustumCullEnabled,
    );
    this._visibleCount = n;

    this.device.queue.writeBuffer(
      this.splatBuffers.index,
      0,
      this._drawIndices.buffer as ArrayBuffer,
      0,
      n * 4,
    );
  }

  /** ★ M4-P2.3: 将 Shader 注入应用到 WGSL 源码 */
  private applyInjectionsToWgsl(baseCode: string, injections: ShaderInjection[]): string {
    let code = baseCode;

    for (const injection of injections) {
      const taggedCode = `// --- injection: ${injection.id} ---\n${injection.code}\n// --- end injection: ${injection.id} ---`;
      switch (injection.hook) {
        case ShaderHookPoint.VERTEX_MAIN_BEGIN:
          code = injectWgslAfterMainBegin(code, 'vs_main', taggedCode);
          break;
        case ShaderHookPoint.VERTEX_BEFORE_POSITION:
          code = injectWgslBeforePattern(code, /output\.position\s*=/, taggedCode);
          break;
        case ShaderHookPoint.VERTEX_MAIN_END:
          code = injectWgslBeforeMainEnd(code, 'vs_main', taggedCode);
          break;
        case ShaderHookPoint.FRAGMENT_MAIN_BEGIN:
          code = injectWgslAfterMainBegin(code, 'fs_main', taggedCode);
          break;
        case ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT:
          // ★ D-12: 现行语义 = main() 末尾 (与 FRAGMENT_MAIN_END 相同), 枚举已标 @deprecated;
          //   WGSL 下两者注入位置一致, 保持向后兼容行为不变。
          code = injectWgslBeforeMainEnd(code, 'fs_main', taggedCode);
          break;
        case ShaderHookPoint.FRAGMENT_MAIN_END:
          code = injectWgslBeforeMainEnd(code, 'fs_main', taggedCode);
          break;
      }
    }

    return code;
  }

  /** ★ M4-P2.3: 更新 injection uniforms (每帧调用 onUpdate 回调) */
  private updateInjectionUniforms(dt: number): void {
    for (const [id, injection] of this._shaderInjections) {
      if (injection.onUpdate) {
        const uniforms = this._injectionUniforms.get(id);
        if (uniforms) {
          injection.onUpdate(uniforms, dt);
        }
      }
    }
  }

  /** 设置视锥裁剪启用状态 */
  setFrustumCulling(enabled: boolean): void {
    this._frustumCullEnabled = enabled;
  }

  /** 获取当前可见 splat 数量 */
  getVisibleSplatCount(): number {
    return this._visibleCount;
  }

  /** 创建渲染管线 */
  private createRenderPipeline(): void {
    if (!this.device || !this.splatData) return;

    // ★ M4-P2.3: 应用 Shader 注入到 WGSL 源码
    let wgslCode = SPLAT_RENDER_SHADER(this.format);
    const injections = Array.from(this._shaderInjections.values());
    if (injections.length > 0) {
      wgslCode = this.applyInjectionsToWgsl(wgslCode, injections);
      console.info(`[WebGPURenderManager] 已应用 ${injections.length} 个 Shader 注入到 WGSL 管线`);
    }

    const shaderModule = this.device.createShaderModule({
      code: wgslCode,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        // ★ TD-01: SH 系数 storage buffer (vs_main 求值, 无 SH 时为占位 buffer)
        { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              // ★ 修复: 使用标准 alpha blending 而非 additive blending
              // 参考: 3DGS 论文中的 alpha compositing: C = src * alpha + dst * (1 - alpha)
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, // 3DGS 不写深度, 使用 alpha blending
        depthCompare: 'always',
      },
    });

    // 创建 bind group
    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.splatBuffers.position! } },
        { binding: 2, resource: { buffer: this.splatBuffers.scale! } },
        { binding: 3, resource: { buffer: this.splatBuffers.color! } },
        { binding: 4, resource: { buffer: this.splatBuffers.rotation! } },
        { binding: 5, resource: { buffer: this.splatBuffers.index! } },
        // ★ TD-01: SH 系数 (无 SH 时占位 buffer)
        { binding: 6, resource: { buffer: this.splatBuffers.sh! } },
      ],
    });
  }

  /** 解析 .splat 格式数据 (32 bytes/splat) */
  private parseSplatData(data: Uint8Array): SplatData {
    const splatBytes = 32;
    const count = Math.floor(data.length / splatBytes);

    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const colors = new Uint8Array(count * 4);
    const rotations = new Uint8Array(count * 4);

    // TD-07: 使用 TypedArray 视图直取替代 DataView 逐字段读取
    // 创建 Float32Array 视图用于读取位置和缩放（小端序）
    const floatView = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const byteView = data; // 直接使用 Uint8Array 视图

    for (let i = 0; i < count; i++) {
      const base = i * splatBytes;
      const floatBase = base / 4; // Float32 索引

      // Position: 3 × Float32 (12 bytes) - 偏移 0-11
      positions[i * 3] = floatView[floatBase];
      positions[i * 3 + 1] = floatView[floatBase + 1];
      positions[i * 3 + 2] = floatView[floatBase + 2];

      // Scale: 3 × Float32 (12 bytes) - 偏移 12-23
      scales[i * 3] = floatView[floatBase + 3];
      scales[i * 3 + 1] = floatView[floatBase + 4];
      scales[i * 3 + 2] = floatView[floatBase + 5];

      // Color: 4 × Uint8 (4 bytes) - 偏移 24-27
      colors[i * 4] = byteView[base + 24];
      colors[i * 4 + 1] = byteView[base + 25];
      colors[i * 4 + 2] = byteView[base + 26];
      colors[i * 4 + 3] = byteView[base + 27];

      // Rotation: 4 × Uint8 (4 bytes) - 偏移 28-31
      rotations[i * 4] = byteView[base + 28];
      rotations[i * 4 + 1] = byteView[base + 29];
      rotations[i * 4 + 2] = byteView[base + 30];
      rotations[i * 4 + 3] = byteView[base + 31];
    }

    return { positions, scales, colors, rotations, count };
  }

  /** 上传 splat 数据到 GPU buffers */
  private uploadSplatData(): void {
    if (!this.device || !this.splatData) return;

    const { positions, scales, colors, rotations, count, sh } = this.splatData;

    // 释放旧 buffer
    this.splatBuffers.position?.destroy();
    this.splatBuffers.scale?.destroy();
    this.splatBuffers.color?.destroy();
    this.splatBuffers.rotation?.destroy();
    this.splatBuffers.index?.destroy();
    this.splatBuffers.sh?.destroy();

    this.splatBuffers.position = this.device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.splatBuffers.position, 0, positions.buffer as ArrayBuffer);

    this.splatBuffers.scale = this.device.createBuffer({
      size: scales.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.splatBuffers.scale, 0, scales.buffer as ArrayBuffer);

    this.splatBuffers.color = this.device.createBuffer({
      size: colors.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.splatBuffers.color, 0, colors.buffer as ArrayBuffer);

    this.splatBuffers.rotation = this.device.createBuffer({
      size: rotations.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.splatBuffers.rotation, 0, rotations.buffer as ArrayBuffer);

    // 初始索引: 0, 1, 2, ..., count-1
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    this.splatBuffers.index = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.device.queue.writeBuffer(this.splatBuffers.index, 0, indices.buffer as ArrayBuffer);

    // ★ TD-01: SH 系数上传 (无 SH 数据时创建 4 字节占位 buffer, WGSL 越界读返回 0)
    if (sh && sh.length > 0) {
      this.splatBuffers.sh = this.device.createBuffer({
        size: sh.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.splatBuffers.sh, 0, sh.buffer as ArrayBuffer);
    } else {
      this.splatBuffers.sh = this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE,
      });
    }
  }

  /** 定位相机到场景包围盒中心 */
  private positionCameraToBounds(): void {
    if (!this.camera || !this.splatData || !this.controls) return;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < this.splatData.count; i++) {
      const x = this.splatData.positions[i * 3];
      const y = this.splatData.positions[i * 3 + 1];
      const z = this.splatData.positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const dist = maxDim * 1.2;

    // ★ 与 RenderManager 一致: 摄像机放在场景中心
    this.camera.position.set(cx, cy + maxDim * 0.5, cz + dist);
    this.camera.lookAt(cx, cy, cz);
    this.camera.near = Math.max(0.01, dist * 0.1);
    this.camera.far = Math.max(100, dist * 10);
    this.camera.updateProjectionMatrix();

    // ★ 自适应移动速度 (★ M4: 委托共享模块)
    this._keyboard.setMoveSpeed(Math.max(maxDim * 0.06, 5.0));
    this._keyboard.setVerticalSpeed(Math.max(maxDim * 0.04, 3.0));
    this.controls.setWheelSpeed(Math.max(maxDim * 0.005, 0.5));

    this.controls.update();

    console.info(
      `[WebGPURenderManager] 摄像机已定位: pos=(${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}), ` +
        `sceneSize=${maxDim.toFixed(2)}, moveSpeed=${this._keyboard.moveSpeed.toFixed(1)}`,
    );
  }

  private updateRenderSize(): void {
    const scale = this.adaptive?.currentResolutionScale ?? this.resolutionScale;
    this.renderWidth = Math.round(this.cssWidth * scale);
    this.renderHeight = Math.round(this.cssHeight * scale);

    if (this.canvas) {
      this.canvas.width = this.renderWidth;
      this.canvas.height = this.renderHeight;
    }
  }

  private onResolutionChanged(scale: number): void {
    this.resolutionScale = scale;
    this.updateRenderSize();
  }
}
