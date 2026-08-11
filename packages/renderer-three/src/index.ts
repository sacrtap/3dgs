/**
 * RenderManager — Three.js + Spark 渲染引擎 SDK
 *
 * v4.3 交互优化:
 *   ✅ 坐标系翻转 — 加载后无条件垂直翻转 (Y-down → Y-up)
 *   ✅ 拖拽式交互 — 自定义 DragLookControls 替代 OrbitControls
 *   ✅ 移动速度 — 默认提速 + 场景自适应
 *
 * v4.2 bug 修复:
 *   ✅ 摄像机自动定位 — 基于 getBoundingBox() 将相机放在场景中心
 *   ✅ 键盘移动平滑 — 速度插值 (加速/减速) 替代瞬间启停
 *   ✅ LOD 构建 — 加载后调用 createLodSplats() 构建 LOD 树
 *
 * v4.1 性能修复:
 *   ✅ antialias: false — WebGL MSAA 对 3DGS 无效且严重降帧 (Spark 官方建议)
 *   ✅ setPixelRatio(1.0) — 不跟随 devicePixelRatio (dpr=2 时像素量 4x)
 *   ✅ 单一 RAF 循环 — 通过 onFrame() 回调供 TourPlayer/插件挂载，杜绝双 RAF
 *   ✅ 设备分级 — 自动检测硬件能力，选择渲染参数
 *   ✅ 自适应分辨率 — 帧率低于阈值时自动降分辨率
 */

import type { RendererAdapter, LoadOptions } from '@3dgs/core';
import { DeviceTier, ShaderHookPoint, type ShaderInjection } from '@3dgs/core';
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { SplatFileType } from '@sparkjsdev/spark';
import { detectDeviceTier, getTierSettings, type DeviceProfile } from './device-tier.js';
import { AdaptiveResolution } from './adaptive-resolution.js';
import { SogStreamer, type SogMetadata } from './sog-streamer.js';
// ★ H3+H4: 接入 FrustumCulling 和 SplatBufferPool (原孤儿模块)
import { FrustumCulling } from './frustum-culling.js';
import { SplatBufferPool } from './buffer-pool.js';
import { DragLookControls } from './drag-look-controls.js';
import { concatChunksInWorker } from './sog-concat-worker.js';
import { decodeSpzInWorker, parseSpzHeader } from './spz-decoder-worker.js';
import { injectAfterMainBegin as injectAfterMainBeginFn, injectBeforePattern as injectBeforePatternFn, injectBeforeMainEnd as injectBeforeMainEndFn, inferGLSLType as inferGLSLTypeFn } from './shader-utils.js';
// ★ M4: 共享模块
import { KeyboardControls } from './keyboard-controls.js';
import { FrameCallbackManager } from './frame-callback-manager.js';
import { CameraMatrixCache } from './camera-matrix-cache.js';

export interface RenderManagerOptions {
  /** 强制设备分级 (默认自动检测) */
  deviceTier?: DeviceTier;
  /** 像素比覆盖 (默认根据设备分级) */
  pixelRatio?: number;
  /** 初始分辨率缩放比 (默认根据设备分级) */
  resolutionScale?: number;
  /** 是否启用自适应分辨率 (默认 true) */
  adaptiveResolution?: boolean;
  /** 清除色 */
  clearColor?: number;
  /** 是否启用键盘移动控制 (WASD + U/E) (默认 true) */
  enableKeyboardControls?: boolean;
  /** 键盘移动速度 (单位/秒, 默认 5.0) */
  moveSpeed?: number;
  /** 键盘升降速度 (单位/秒, 默认 3.0) */
  verticalSpeed?: number;
  /** 是否加载后垂直翻转 (默认 true) */
  autoOrient?: boolean;
  /** 是否加载后构建 LOD 树 (默认 true) */
  enableLod?: boolean;
}

// ─── RenderManager ─────────────────────────────────────────

export class RenderManager implements RendererAdapter {
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: DragLookControls;
  private spark?: SparkRenderer;
  private container?: HTMLElement;
  private currentSplat?: SplatMesh;
  private ro?: ResizeObserver;
  private rafId = 0;
  private _running = false;
  private _destroyed = false;

  // ★ M4: 共享模块实例
  private _frameCallbacks = new FrameCallbackManager();
  private _cameraCache = new CameraMatrixCache();
  private _keyboard: KeyboardControls;

  // 设备信息
  private deviceProfile: DeviceProfile;
  private tierSettings: ReturnType<typeof getTierSettings>;
  private adaptive?: AdaptiveResolution;
  private resolutionScale: number;

  // 离屏渲染尺寸 (分辨率缩放)
  private renderWidth = 0;
  private renderHeight = 0;
  private cssWidth = 0;
  private cssHeight = 0;

  // 坐标矫正 & LOD
  private _autoOrient: boolean;
  private _enableLod: boolean;
  private _lodReady = false;
  /** ★ M2 衍生: 预构建 SOG LOD 层级 (累计 splat 数), undefined = 无预构建 */
  private _sogLodLevels?: number[];
  /** ★ M2 衍生: LOD 缩减因子 */
  private _sogLodBase?: number;

  // ★ SOG 流式加载器 (用于 abort)
  private _sogStreamer?: SogStreamer;

  // ★ H2: WebGL context lost/restore 处理
  private _currentSceneSource?: string;
  private _currentSceneOptions?: LoadOptions;
  private _contextLostHandler?: (e: Event) => void;
  private _contextRestoredHandler?: (e: Event) => void;

  // ★ H3: FrustumCulling 视锥剔除 (可见性监控)
  private _frustumCulling?: FrustumCulling;
  private _frustumFrameCounter = 0;

  // ★ H4: SplatBufferPool 缓冲池
  private _bufferPool = new SplatBufferPool({ maxPoolSize: 8 });

  // ★ H5: _lodReady 信号消费
  private _lodReadyLogged = false;

  // ★ dt 平滑 (指数移动平均, 用于移动和帧回调)
  private _smoothDt = 16.67;

  // ★ Shader 注入
  private _shaderInjections = new Map<string, ShaderInjection>();
  private _compiledMaterials = new Set<THREE.Material>();
  private _injectionUniforms = new Map<string, Record<string, THREE.IUniform>>();

  constructor(options: RenderManagerOptions = {}) {
    this.deviceProfile = detectDeviceTier();
    const tier = options.deviceTier ?? this.deviceProfile.tier;
    this.tierSettings = getTierSettings(tier);

    this.resolutionScale = options.resolutionScale ?? this.tierSettings.resolutionScale;
    const pixelRatio = options.pixelRatio ?? this.tierSettings.pixelRatio;

    this._pixelRatio = pixelRatio;
    this._keyboard = new KeyboardControls({
      moveSpeed: options.moveSpeed ?? 5.0,
      verticalSpeed: options.verticalSpeed ?? 3.0,
      enabled: options.enableKeyboardControls ?? true,
    });
    this._autoOrient = options.autoOrient ?? true;
    this._enableLod = options.enableLod ?? true;

    if (options.adaptiveResolution !== false) {
      this.adaptive = new AdaptiveResolution(
        this.resolutionScale,
        (scale) => this.onResolutionChanged(scale),
      );
    }
  }

  private _pixelRatio: number;

  // ─── RendererAdapter 实现 ────────────────────────────────

  mount(container: HTMLElement): void {
    this.container = container;
  }

  start(): void {
    if (!this.container || this._running) return;

    const rect = this.container.getBoundingClientRect();
    this.cssWidth = rect.width || window.innerWidth;
    this.cssHeight = rect.height || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });

    renderer.setPixelRatio(this._pixelRatio);
    renderer.setSize(this.cssWidth, this.cssHeight);
    renderer.setClearColor(0x111111);
    this.container.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%',
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, this.cssWidth / this.cssHeight, 0.1, 1000);
    camera.position.set(0, 0, 0);

    // ★ DragLookControls 替代 OrbitControls
    const controls = new DragLookControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.003;
    controls.wheelSpeed = 0.5;

    const spark = new SparkRenderer({
      renderer,
      // ★ P0: 根据 Tier 配置 LOD 和渲染参数
      enableLod: this._enableLod,
      lodSplatScale: this.tierSettings.lodSplatScale,
      lodRenderScale: this.tierSettings.lodRenderScale,
      maxStdDev: this.tierSettings.maxStdDev,
      minPixelRadius: this.tierSettings.minPixelRadius,
      clipXY: this.tierSettings.clipXY,
      // ★ P0-3: 排序节流 — 减少排序频率以提升帧率
      //   LOW=100ms (6-10fps sort), MEDIUM=50ms (20fps sort)
      //   HIGH=33ms (30fps sort), ULTRA=16ms (60fps sort)
      minSortIntervalMs: this.tierSettings.minSortIntervalMs,
      // ★ P0-4: 注视点渲染 (Foveated Rendering) — 中心高分辨率, 边缘降分辨率
      //   减少 overdraw, 在低端设备上可提升 20-40% 帧率
      //   [来源: Spark API — SparkRendererOptions.coneFov0/coneFov/coneFoveate/behindFoveate]
      coneFov0: this.tierSettings.coneFov0,
      coneFov: this.tierSettings.coneFov,
      coneFoveate: this.tierSettings.coneFoveate,
      behindFoveate: this.tierSettings.behindFoveate,
      // ★ P1-1: PagedSplats GPU 内存页池大小 + 并行 chunk 获取器
      //   [来源: Spark API — SparkRendererOptions.maxPagedSplats/numLodFetchers]
      maxPagedSplats: this.tierSettings.maxPagedSplats,
      numLodFetchers: this.tierSettings.numLodFetchers,
      // ★ L1: Splat 模糊量 — 添加到 2D 协方差对角线, 产生抗锯齿效果
      //   LOW=0.1 (减少 overdraw), MEDIUM=0.2, HIGH/ULTRA=0.3 (Spark 默认)
      //   [来源: Spark 源码 — spark.module.js:9874 this.blurAmount = options.blurAmount ?? 0.3]
      blurAmount: this.tierSettings.blurAmount,
      // ★ L1 衡生: 最小 alpha 渲染阈值 — 低于此值的 splat 被 discard
      //   LOW=5/255 (激进裁剪), MEDIUM=2/255, HIGH=1/255, ULTRA=0.5/255 (Spark 默认)
      //   [来源: Spark 类型 — SparkRenderer.d.ts:73 minAlpha?: number]
      minAlpha: this.tierSettings.minAlpha,
      // ★ L1 衡生: 投影 splat 缩放校正值 — 控制锐利度
      //   LOW/MEDIUM=1.0 (Spark 默认), HIGH=1.5, ULTRA=2.0 (匹配 PlayCanvas)
      //   [来源: Spark 类型 — SparkRenderer.d.ts:130 focalAdjustment?: number]
      focalAdjustment: this.tierSettings.focalAdjustment,
    });
    spark.renderSize.set(this.cssWidth, this.cssHeight);
    scene.add(spark);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.spark = spark;
    this._running = true;

    this.updateRenderSize();

    if (this._keyboard.isEnabled) {
      this._keyboard.setup();
    }

    // ★ 单一 RAF 循环
    let lastTime = performance.now();
    const loop = () => {
      if (!this._running || this._destroyed) return;

      const now = performance.now();
      const rawDt = now - lastTime;
      lastTime = now;

      // ★ 连续指数平滑 dt (替代固定时间步长累加器)
      //
      // 固定步长的问题: 物理更新与渲染不同步, 量化伪影导致跳变
      //   帧1(14ms): accumulator=14ms → 0步 → 位置不变
      //   帧2(18ms): accumulator=32ms → 1步 → 位置跳变 ← 可见卡顿
      //
      // 连续平滑: 每帧用平滑后的 dt 做连续指数插值, 无量化跳变
      //   指数移动平均过滤单帧尖峰, 保留真实帧率趋势
      this._smoothDt = this._smoothDt * 0.9 + rawDt * 0.1;
      const dt = Math.min(this._smoothDt, 50);

      // ★ M4: 键盘移动 (共享模块)
      this._keyboard.applyMovement(camera, dt);

      controls.update();
      renderer.render(scene, camera);

      // ★ M4: 更新矩阵缓存 (共享模块)
      this._cameraCache.update(camera);

      // ★ M4: 帧回调 (共享模块)
      this._frameCallbacks.invoke(dt);

      // ★ Shader 注入 uniform 更新
      this.updateInjectionUniforms(dt);

      this.adaptive?.sample();

      // ★ H3: FrustumCulling 可见性监控 (每 60 帧 ≈1s 采样一次)
      if (this._frustumCulling && this._frustumFrameCounter++ % 60 === 0) {
        try {
          const ratio = this._frustumCulling.getVisibleRatio(this._cameraCache.vpMatrixTHREE);
          const visible = Math.round(ratio * this._frustumCulling.getTotalSplats());
          console.debug(
            `[RenderManager] FrustumCulling: ${(ratio * 100).toFixed(1)}% visible (${visible.toLocaleString()} / ${this._frustumCulling.getTotalSplats().toLocaleString()} splats)`,
          );
        } catch {
          /* 安全 */
        }
      }

      // ★ H5: _lodReady 信号消费 — LOD 就绪时通知一次
      if (this._enableLod && !this._lodReadyLogged && this._lodReady) {
        this._lodReadyLogged = true;
        console.info('[RenderManager] LOD 构建完成, 渲染质量已提升');
      }

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    this.ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (w === 0 || h === 0) return;
      this.cssWidth = w;
      this.cssHeight = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      this.updateRenderSize();
    });
    this.ro.observe(this.container);

    // ★ H2: WebGL context lost/restore 事件处理
    //   context 丢失后 GPU buffer 全部失效, 需重新加载场景
    //   移动端和集显设备在内存压力下高发
    this._contextLostHandler = (e: Event) => {
      e.preventDefault();
      console.warn('[RenderManager] WebGL context lost — GPU 资源已释放, 等待 restore...');
      this._running = false;
    };
    this._contextRestoredHandler = () => {
      console.info('[RenderManager] WebGL context restored — 重新加载场景');
      this._running = true;
      if (this._currentSceneSource) {
        this.loadScene(this._currentSceneSource, this._currentSceneOptions).catch((err) => {
          console.error('[RenderManager] context restored 后重载场景失败:', err);
        });
      }
      // 重启 RAF 循环
      if (this.rafId === 0) {
        let lastTime = performance.now();
        const loop = () => {
          if (!this._running || this._destroyed) return;
          const now = performance.now();
          this._smoothDt = this._smoothDt * 0.9 + (now - lastTime) * 0.1;
          lastTime = now;
          const dt = Math.min(this._smoothDt, 50);
          this._keyboard.applyMovement(this.camera!, dt);
          this.controls?.update();
          if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
          }
          this.adaptive?.sample();
          this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
      }
    };
    renderer.domElement.addEventListener('webglcontextlost', this._contextLostHandler);
    renderer.domElement.addEventListener('webglcontextrestored', this._contextRestoredHandler);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this._running = false;
  }

  async loadScene(source: string, options?: LoadOptions): Promise<void> {
    if (!this.scene) throw new Error('RenderManager 未启动');

    // 中止之前的 SOG 流式加载 (如果有)
    this._sogStreamer?.abort();
    this._sogStreamer = undefined;

    // 移除旧场景
    if (this.currentSplat) {
      this.scene.remove(this.currentSplat);
      this.currentSplat.dispose();
      this.currentSplat = undefined;
    }

    this._lodReady = false;
    this._lodReadyLogged = false;
    // ★ M2 衍生: 重置预构建 LOD 数据
    this._sogLodLevels = undefined;
    this._sogLodBase = undefined;

    // ★ H2: 记录当前场景信息, 供 context restored 后重载
    this._currentSceneSource = source;
    this._currentSceneOptions = options;

    // ★ 若提供 lodSource (SOG 流式 LOD URL)，优先使用流式加载
    if (options?.lodSource) {
      try {
        await this.loadSceneWithSog(options.lodSource, options);
        return;
      } catch (err) {
        console.warn(
          '[RenderManager] SOG 流式加载失败, 回退到 source 直接加载:',
          err instanceof Error ? err.message : err,
        );
        // 回退到 source 直接加载
      }
    }

    // ★ P1-4: 对 .spz 文件使用 Worker 解码, 避免主线程阻塞
    if (source.endsWith('.spz')) {
      try {
        await this.loadSceneWithSpz(source, options);
        return;
      } catch (err) {
        console.warn('[RenderManager] SPZ Worker 解码失败, 回退到 URL 直接加载:', err);
      }
    }

    // 直接加载 source
    // P0: 对 .splat 文件执行 fetch + truncate, 确保实际限制 splat 数量
    if (source.endsWith('.splat') && this.tierSettings.maxSplats < 10_000_000) {
      try {
        await this.loadSceneWithTruncatedSplat(source, options);
        return;
      } catch (err) {
        console.warn('[RenderManager] 截断加载失败, 回退到 URL 直接加载:', err);
      }
    }

    return new Promise<void>((resolve, reject) => {
      new SplatMesh({
        url: source,
        maxSplats: this.tierSettings.maxSplats,
        onProgress: (e: ProgressEvent) => {
          if (e.lengthComputable && options?.onProgress) {
            options.onProgress(e.loaded, e.total);
          }
        },
        onLoad: async (loadedMesh: SplatMesh) => {
          // ★ Bug 1 修复: 无条件垂直翻转 (Y-down → Y-up)
          if (this._autoOrient) {
            loadedMesh.rotation.x = Math.PI;
          }

          this.scene!.add(loadedMesh);
          this.currentSplat = loadedMesh;

          // ★ Bug 2 修复: 基于包围盒自动定位摄像机
          this.positionCameraToBounds(loadedMesh);

          // ★ Bug 4 修复: 构建 LOD 树 (P0: 根据设备分级选择质量)
          if (this._enableLod) {
            this.buildLod(loadedMesh);
          }

          // ★ 应用 Shader 注入
          this.applyInjectionsToMaterial();

          resolve();
        },
      });

      if (!source) {
        reject(new Error('loadScene: source 为空'));
      }
    });
  }

  /**
   * P0: 降采样加载 .splat 文件 — fetch + uniform subsample + fileBytes
   *
   * Spark 的 maxSplats 参数仅是预分配提示, 不会实际限制 splat 数量。
   * 此方法通过 fetch 获取完整文件, 对 splat 进行均匀降采样后传入 Spark,
   * 确保低端设备实际渲染的 splat 数量受控。
   *
   * ★ Bug 修复: 原截断方案取前 N 个 splat, 而 .splat 文件中 splat 顺序
   *   与 PLY vertex 顺序一致 (训练序, 非空间排序), 导致截断后出现大面积
   *   空间空洞 (黑色区域)。改为均匀降采样 (每隔 K 个取 1 个) 后,
   *   空间覆盖均匀, 不会出现黑色区域。
   *
   * [来源: Spark SplatMeshOptions — maxSplats 为预分配, 不截断]
   * [来源: .splat 格式 — 每 splat 固定 32 字节]
   */
  private async loadSceneWithTruncatedSplat(source: string, options?: LoadOptions): Promise<void> {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`fetch ${source}: ${response.status}`);
    }

    // 读取完整文件
    const arrayBuffer = await response.arrayBuffer();
    const fullData = new Uint8Array(arrayBuffer);
    const totalSplats = Math.floor(fullData.byteLength / 32);
    const maxSplats = this.tierSettings.maxSplats;

    // 如果 splat 数量未超限, 直接使用全量数据
    if (totalSplats <= maxSplats) {
      console.info(`[RenderManager] 全量加载: ${totalSplats.toLocaleString()} splats (无需降采样)`);
      await this.createSplatMeshFromBytes(fullData, options);
      return;
    }

    // ★ 均匀降采样: 每隔 step 个 splat 取 1 个, 保持空间覆盖均匀
    const step = totalSplats / maxSplats;
    const sampledSplats = Math.floor(totalSplats / step);
    // ★ H4: 使用 SplatBufferPool 复用 ArrayBuffer, 减少 GC 压力
    const sampledData = new Uint8Array(this._bufferPool.acquire(sampledSplats * 32));

    for (let i = 0; i < sampledSplats; i++) {
      const srcOffset = Math.floor(i * step) * 32;
      const dstOffset = i * 32;
      sampledData.set(fullData.subarray(srcOffset, srcOffset + 32), dstOffset);
    }

    console.info(
      `[RenderManager] 降采样加载: ${sampledSplats.toLocaleString()} / ${totalSplats.toLocaleString()} splats ` +
      `(step=${step.toFixed(2)}, 保留 ${(sampledSplats / totalSplats * 100).toFixed(1)}%)`,
    );

    if (options?.onProgress) {
      options.onProgress(totalSplats, totalSplats);
    }

    await this.createSplatMeshFromBytes(sampledData, options);
  }

  /**
   * 从 .splat 字节数据创建 SplatMesh 并添加到场景
   */
  private async createSplatMeshFromBytes(data: Uint8Array, _options?: LoadOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      new SplatMesh({
        fileBytes: data,
        fileType: SplatFileType.SPLAT,
        onLoad: async (loadedMesh: SplatMesh) => {
          if (this._autoOrient) {
            loadedMesh.rotation.x = Math.PI;
          }
          this.scene!.add(loadedMesh);
          this.currentSplat = loadedMesh;
          // ★ H3: 从 splat 数据创建 FrustumCulling 实例, 用于可见性监控
          try {
            this._frustumCulling = new FrustumCulling(data);
          } catch {
            this._frustumCulling = undefined;
          }
          this.positionCameraToBounds(loadedMesh);
          if (this._enableLod) {
            this.buildLod(loadedMesh);
          }
          this.applyInjectionsToMaterial();
          resolve();
        },
      });

      setTimeout(() => reject(new Error('SplatMesh 创建超时')), 30000);
    });
  }

  /**
   * ★ P1-4: SPZ Worker 解码加载
   *
   * 工作流程:
   *   1. fetch 获取 SPZ 文件 (支持进度回调)
   *   2. 在 Web Worker 中执行 gzip 解压 + 反量化 → .splat 格式字节
   *   3. 若 splat 数量超过 maxSplats, 均匀降采样
   *   4. 创建 SplatMesh({ fileBytes, fileType: SPLAT })
   *
   * 优势 (相比 Spark URL 直接加载):
   *   ✅ 主线程不阻塞 — gzip 解压 + 反量化在 Worker 中执行
   *   ✅ 支持 maxSplats 截断 — 与 .splat 加载路径一致的降采样逻辑
   *   ✅ 进度回调 — fetch 阶段可报告下载进度
   *
   * 注意: 解码为 .splat 格式后不支持 SH 球谐系数。
   *       如需 SH, 请使用 Spark URL 直接加载 (回退路径)。
   *
   * [来源: SPZ 格式 — github.com/nianticlabs/spz]
   * [来源: 项目源码 — packages/renderer-three/src/spz-decoder-worker.ts]
   */
  private async loadSceneWithSpz(source: string, options?: LoadOptions): Promise<void> {
    // 1. fetch 获取 SPZ 文件 (支持进度回调)
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`fetch ${source}: ${response.status}`);
    }

    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
    const reader = response.body?.getReader();

    if (!reader) {
      // 无 body stream, 直接读取
      const spzData = await response.arrayBuffer();
      const splatBytes = await decodeSpzInWorker(spzData);
      await this.createSplatMeshFromSplatBytes(splatBytes, options);
      return;
    }

    // 分块读取, 报告下载进度
    const chunks: Uint8Array[] = [];
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedLength += value.byteLength;
        if (options?.onProgress && contentLength > 0) {
          options.onProgress(receivedLength, contentLength);
        }
      }
    }

    // 合并 chunks
    const spzData = new Uint8Array(receivedLength);
    let offset = 0;
    for (const chunk of chunks) {
      spzData.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // 2. 解析 header (获取 splat 数量, 用于日志)
    const header = parseSpzHeader(spzData);
    console.info(
      `[RenderManager] SPZ 文件已下载: ${header.numSplats.toLocaleString()} splats, ` +
      `${(spzData.byteLength / 1024 / 1024).toFixed(2)} MB (压缩)`,
    );

    // 3. 在 Worker 中解码 SPZ → .splat 格式
    const splatBytes = await decodeSpzInWorker(spzData.buffer.slice(spzData.byteOffset, spzData.byteOffset + spzData.byteLength));

    // 4. 若 splat 数量超过 maxSplats, 均匀降采样
    const maxSplats = this.tierSettings.maxSplats;
    if (header.numSplats > maxSplats) {
      const step = header.numSplats / maxSplats;
      const sampledSplats = Math.floor(header.numSplats / step);
      // ★ H4: 使用 SplatBufferPool 复用 ArrayBuffer
      const sampledData = new Uint8Array(this._bufferPool.acquire(sampledSplats * 32));

      for (let i = 0; i < sampledSplats; i++) {
        const srcOffset = Math.floor(i * step) * 32;
        const dstOffset = i * 32;
        sampledData.set(splatBytes.subarray(srcOffset, srcOffset + 32), dstOffset);
      }

      console.info(
        `[RenderManager] SPZ 降采样: ${sampledSplats.toLocaleString()} / ${header.numSplats.toLocaleString()} splats ` +
        `(step=${step.toFixed(2)}, 保留 ${(sampledSplats / header.numSplats * 100).toFixed(1)}%)`,
      );

      if (options?.onProgress) {
        options.onProgress(header.numSplats, header.numSplats);
      }

      await this.createSplatMeshFromSplatBytes(sampledData, options);
    } else {
      console.info(
        `[RenderManager] SPZ 全量加载: ${header.numSplats.toLocaleString()} splats (无需降采样)`,
      );

      if (options?.onProgress) {
        options.onProgress(header.numSplats, header.numSplats);
      }

      await this.createSplatMeshFromSplatBytes(splatBytes, options);
    }
  }

  /**
   * 从 .splat 字节数据创建 SplatMesh 并添加到场景
   * (复用 createSplatMeshFromBytes 的逻辑, 但不使用 options 参数)
   */
  private async createSplatMeshFromSplatBytes(data: Uint8Array, _options?: LoadOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      new SplatMesh({
        fileBytes: data,
        fileType: SplatFileType.SPLAT,
        maxSplats: this.tierSettings.maxSplats,
        onLoad: async (loadedMesh: SplatMesh) => {
          if (this._autoOrient) {
            loadedMesh.rotation.x = Math.PI;
          }
          this.scene!.add(loadedMesh);
          this.currentSplat = loadedMesh;
          // ★ H3: 从 splat 数据创建 FrustumCulling 实例
          try {
            this._frustumCulling = new FrustumCulling(data);
          } catch {
            this._frustumCulling = undefined;
          }
          this.positionCameraToBounds(loadedMesh);
          if (this._enableLod) {
            this.buildLod(loadedMesh);
          }
          this.applyInjectionsToMaterial();
          resolve();
        },
      });

      setTimeout(() => reject(new Error('SplatMesh 创建超时 (SPZ)')), 30000);
    });
  }

  /**
   * ★ SOG 流式加载 — 使用 SogStreamer 全量加载 + SplatMesh 创建
   *
   * 设计决策: 不使用 Spark PagedSplats 分页加载, 原因如下 (M1 技术债务已关闭):
   *
   *   Spark PagedSplats 要求每个 chunk 的解码结果包含 extra.lodTree (Uint32Array),
   *   这是 Spark RAD 格式的预构建 LOD 树数据。SplatPager.processFetched() 将其放入
   *   lodTreeUpdates, SparkRenderer.consumeLodTreeUpdates() 仅在
   *   `if (lodTree && chunk === 0)` 时设置 record.rootPage。
   *
   *   SOG 格式存储 Morton 排序的 .splat 数据, 不包含 Spark 兼容的 LOD 树。
   *   unpackSplats() 解码 .splat 数据后 extra.lodTree 为 undefined →
   *   rootPage 永不设置 → mesh 被 updateLodInstances 永久排除 → 黑屏。
   *
   *   这不是 API 使用错误, 而是格式层面的不兼容。修复需要:
   *   - 在 SOG chunk 中嵌入 Spark LOD 树 (关联 M2 技术债务), 或
   *   - 运行时用 Spark WASM 构建 LOD 树 (深度耦合 Spark 内部实现)
   *
   * 当前方案: 直接使用 SogStreamer 全量加载所有 chunk, 拼接后创建常规 SplatMesh。
   *   - 首个 chunk 到达即创建临时 Mesh (首帧快速可见)
   *   - 全量 chunk 拼接后替换为完整 Mesh
   *   - 使用 positionCameraToBounds() 基于实际 Mesh 包围盒定位相机 (正确处理 Y 翻转)
   *   - 与 .splat 文件加载路径完全一致, 已验证可靠
   *
   * [来源: Spark 源码 — spark.module.js:10474 consumeLodTreeUpdates rootPage 检查]
   * [来源: Spark 源码 — spark.module.js:10559 updateLodInstances rootPage 排除逻辑]
   * [来源: Spark 类型 — defines.d.ts:63 PackedExtra.lodTree?: Uint32Array]
   * [来源: SogStreamer — packages/renderer-three/src/sog-streamer.ts]
   */
  private async loadSceneWithSog(
    lodSource: string,
    options?: LoadOptions,
  ): Promise<void> {
    await this.loadSceneWithSogFallback(lodSource, options);
  }

  /**
   * ★ SOG 流式加载实现 — SogStreamer 全量加载 + 双 Mesh 方案
   *
   * 工作流程:
   *   1. SogStreamer 并行加载所有 chunk (4 路并行, HTTP Range 请求)
   *   2. 首个 chunk (chunk 0) 到达后立即创建临时 SplatMesh → 首帧可见
   *   3. 所有 chunk 加载完成后, 使用 concatChunksInWorker 拼接为完整 buffer
   *   4. 移除临时 Mesh, 创建包含全量数据的 SplatMesh
   *   5. 使用 positionCameraToBounds() 基于实际 Mesh 包围盒定位相机
   *
   * 此方法是 SOG 加载的唯一路径。
   */
  private async loadSceneWithSogFallback(
    lodSource: string,
    options?: LoadOptions,
  ): Promise<void> {
    const chunkDataList: ArrayBuffer[] = [];
    let metadata: SogMetadata | null = null;
    let firstMeshReady = false;

    const streamer = new SogStreamer({
      url: lodSource,
      parallel: true,
      parallelCount: 4,
      // ★ P2: 早期终止加载 — 只加载足够提供 maxSplats 个 splat 的前 N 个 chunk
      //   SOG 数据是 Morton 排序的, 前 N 个 chunk 包含空间均匀分布的子集
      //   例如: Garden 5.83M splats, maxSplats=500K → 只需 31/357 chunks (8.7%)
      maxSplats: this.tierSettings.maxSplats,
      onProgress: (loadedChunks, totalChunks, loadedSplats, totalSplats) => {
        if (options?.onProgress) {
          options.onProgress(loadedSplats, totalSplats);
        }
      },
      onChunkLoaded: (chunkIndex, data, _count) => {
        chunkDataList[chunkIndex] = data;
        if (!firstMeshReady && chunkIndex === 0) {
          firstMeshReady = true;
          options?.onFirstFrame?.();
          new SplatMesh({
            fileBytes: new Uint8Array(data),
            fileType: SplatFileType.SPLAT,
            maxSplats: this.tierSettings.maxSplats,
            onLoad: async (loadedMesh: SplatMesh) => {
              if (this._autoOrient) {
                loadedMesh.rotation.x = Math.PI;
              }
              this.scene!.add(loadedMesh);
              this.currentSplat = loadedMesh;
              this.positionCameraToBounds(loadedMesh);
              this.applyInjectionsToMaterial();
            },
          });
        }
      },
      onError: (error) => {
        console.error('[RenderManager] SOG chunk 加载错误:', error.message);
      },
    });

    this._sogStreamer = streamer;
    metadata = await streamer.start();

    if (this.currentSplat) {
      this.scene!.remove(this.currentSplat);
      this.currentSplat.dispose();
      this.currentSplat = undefined;
    }

    const fullBuffer = await concatChunksInWorker(chunkDataList);

    // ★ P0: SOG 降采样 — 与 .splat 加载路径一致的降采样逻辑
    //   maxSplats 仅是预分配提示, 不会实际限制 splat 数量。
    //   P2 早期终止加载后, 加载的 splat 数可能略超 maxSplats (因为按 chunk 粒度截断)。
    //   SOG 数据是 Morton 排序的, 均匀降采样能保持空间覆盖均匀。
    //   [来源: 项目源码 — packages/renderer-three/src/index.ts loadSceneWithTruncatedSplat]
    const fullData = new Uint8Array(fullBuffer);
    const loadedSplats = Math.floor(fullData.byteLength / 32);
    const maxSplats = this.tierSettings.maxSplats;
    let meshData: Uint8Array = fullData;

    if (loadedSplats > maxSplats) {
      const step = loadedSplats / maxSplats;
      const sampledSplats = Math.floor(loadedSplats / step);
      const sampledData = new Uint8Array(this._bufferPool.acquire(sampledSplats * 32));

      for (let i = 0; i < sampledSplats; i++) {
        const srcOffset = Math.floor(i * step) * 32;
        const dstOffset = i * 32;
        sampledData.set(fullData.subarray(srcOffset, srcOffset + 32), dstOffset);
      }

      console.info(
        `[RenderManager] SOG 降采样: ${sampledSplats.toLocaleString()} / ${loadedSplats.toLocaleString()} splats ` +
        `(step=${step.toFixed(2)}, 保留 ${(sampledSplats / loadedSplats * 100).toFixed(1)}%)`,
      );
      meshData = sampledData;
    }

    await new Promise<void>((resolve, reject) => {
      new SplatMesh({
        fileBytes: meshData,
        fileType: SplatFileType.SPLAT,
        maxSplats: this.tierSettings.maxSplats,
        onLoad: async (loadedMesh: SplatMesh) => {
          if (this._autoOrient) {
            loadedMesh.rotation.x = Math.PI;
          }
          this.scene!.add(loadedMesh);
          this.currentSplat = loadedMesh;
          this.positionCameraToBounds(loadedMesh);
          if (this._enableLod) {
            this.buildLodNonBlocking(loadedMesh, metadata);
          }
          this.applyInjectionsToMaterial();
          resolve();
        },
      });

      setTimeout(() => {
        reject(new Error('SOG 完整 mesh 创建超时'));
      }, 10000);
    });

    const compressionStr = metadata.compression === 1 ? 'gzip' : 'none';
    const quantStr = metadata.positionQuantization === 1 ? '24bit' : 'off';
    console.info(
      `[RenderManager] SOG 回退加载完成: ${metadata.numSplats.toLocaleString()} splats, ` +
      `${metadata.numChunks} chunks, compression=${compressionStr}, posQuant=${quantStr}, v${metadata.version}`,
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

  // ─── Shader 注入 API ──────────────────────────────────────

  addShaderInjection(injection: ShaderInjection): void {
    if (this._shaderInjections.has(injection.id)) {
      console.warn(`[RenderManager] Shader 注入 '${injection.id}' 已存在, 将被覆盖`);
      this.removeShaderInjection(injection.id);
    }

    this._shaderInjections.set(injection.id, injection);

    // 为此注入创建 Three.js uniform 对象
    const threeUniforms: Record<string, THREE.IUniform> = {};
    if (injection.uniforms) {
      for (const [key, value] of Object.entries(injection.uniforms)) {
        threeUniforms[key] = { value };
      }
    }
    this._injectionUniforms.set(injection.id, threeUniforms);

    // 如果 SparkRenderer 已存在, 立即应用
    if (this.spark) {
      this.applyInjectionsToMaterial();
    }
  }

  removeShaderInjection(id: string): void {
    this._shaderInjections.delete(id);
    this._injectionUniforms.delete(id);

    // 重新编译材质 (移除注入后重新应用所有剩余注入)
    if (this.spark) {
      this.applyInjectionsToMaterial();
    }
  }

  /**
   * 将所有 Shader 注入应用到 SparkRenderer 的材质
   *
   * SparkRenderer 继承自 THREE.Mesh, 拥有 readonly material: THREE.ShaderMaterial。
   * 通过直接修改 ShaderMaterial 的 vertexShader/fragmentShader 源码实现注入:
   *   - 每次调用都从原始 shader 源码重新构建 (保证增删注入后状态一致)
   *   - 注入自定义 uniform 声明和值
   *   - 每帧通过 updateInjectionUniforms() 更新 uniform 值
   *
   * [来源: SparkRenderer 类型 — @sparkjsdev/spark SparkRenderer.d.ts]
   * [来源: Three.js 文档 — ShaderMaterial.vertexShader / fragmentShader]
   */
  private applyInjectionsToMaterial(): void {
    if (!this.spark) return;
    const material = this.spark.material as THREE.ShaderMaterial;
    if (!material) return;

    // 保存原始 shader (仅在第一次调用时保存, 后续始终从原始源码重建)
    if (!(material as unknown as { _originalVertexShader?: string })._originalVertexShader) {
      (material as unknown as { _originalVertexShader?: string })._originalVertexShader = material.vertexShader;
      (material as unknown as { _originalFragmentShader?: string })._originalFragmentShader = material.fragmentShader;
    }

    const origVS = (material as unknown as { _originalVertexShader: string })._originalVertexShader;
    const origFS = (material as unknown as { _originalFragmentShader: string })._originalFragmentShader;

    const injections = Array.from(this._shaderInjections.values());

    // 无注入时, 恢复原始 shader 源码
    if (injections.length === 0) {
      material.vertexShader = origVS;
      material.fragmentShader = origFS;
      material.needsUpdate = true;
      return;
    }

    // 合并所有注入的 uniforms
    const allUniforms: Record<string, THREE.IUniform> = {};
    for (const [, uniforms] of this._injectionUniforms) {
      Object.assign(allUniforms, uniforms);
    }

    // 对于 ShaderMaterial, 直接修改 vertexShader/fragmentShader 和 uniforms
    // ShaderMaterial 不触发 onBeforeCompile, 而是直接使用其 shader 源码
    // 所以我们需要直接修改 material.vertexShader / fragmentShader / uniforms

    let vs = origVS;
    let fs = origFS;

    // 收集 uniform 声明
    const uniformDecls: string[] = [];
    for (const injection of injections) {
      if (injection.uniforms) {
        for (const key of Object.keys(injection.uniforms)) {
          const val = injection.uniforms[key];
          const glslType = this.inferGLSLType(val);
          if (glslType) {
            uniformDecls.push(`uniform ${glslType} ${key};`);
          }
        }
      }
    }
    const uniformBlock = uniformDecls.join('\n');

    // 注入到着色器
    for (const injection of injections) {
      const code = `// --- injection: ${injection.id} ---\n${injection.code}\n// --- end injection: ${injection.id} ---`;
      switch (injection.hook) {
        case ShaderHookPoint.VERTEX_MAIN_BEGIN:
          vs = this.injectAfterMainBegin(vs, code);
          break;
        case ShaderHookPoint.VERTEX_BEFORE_POSITION:
          vs = this.injectBeforePattern(vs, /gl_Position\s*=/, code);
          break;
        case ShaderHookPoint.VERTEX_MAIN_END:
          vs = this.injectBeforeMainEnd(vs, code);
          break;
        case ShaderHookPoint.FRAGMENT_MAIN_BEGIN:
          fs = this.injectAfterMainBegin(fs, code);
          break;
        case ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT:
          // ★ 在 main() 末尾注入 (fragColor 赋值之后)
          //
          // Spark 的 fragment shader 使用 GLSL ES 3.00 (glslVersion: THREE.GLSL3),
          // 输出变量为 `out vec4 fragColor`, 在 main() 内通过 `fragColor = ...` 赋值。
          //
          // 如果在 `fragColor =` 之前注入, 则 fragColor 尚未赋值, 读取它属于未定义行为。
          // 因此改为在 main() 末尾 (最后的 } 之前) 注入, 确保 fragColor 已被赋值,
          // 注入代码可以安全地读取和修改 fragColor。
          //
          // [来源: Spark fragment shader — @sparkjsdev/spark splatFragment_default]
          // [来源: Three.js GLSL3 — THREE.GLSL3, out vec4 fragColor]
          fs = this.injectBeforeMainEnd(fs, code);
          break;
        case ShaderHookPoint.FRAGMENT_MAIN_END:
          fs = this.injectBeforeMainEnd(fs, code);
          break;
      }
    }

    // 插入 uniform 声明
    if (uniformBlock) {
      vs = vs.replace(/(void\s+main\s*\(\s*\))/, `${uniformBlock}\n$1`);
      fs = fs.replace(/(void\s+main\s*\(\s*\))/, `${uniformBlock}\n$1`);
    }

    material.vertexShader = vs;
    material.fragmentShader = fs;

    // 合并 uniforms 到材质
    Object.assign(material.uniforms, allUniforms);

    material.needsUpdate = true;
  }

  /** 在 main() 的开头插入代码 */
  private injectAfterMainBegin(shader: string, code: string): string {
    return injectAfterMainBeginFn(shader, code);
  }

  /** 在指定正则模式之前插入代码 */
  private injectBeforePattern(shader: string, pattern: RegExp, code: string): string {
    return injectBeforePatternFn(shader, pattern, code);
  }

  /** 在 main() 的结尾 (最后的 }) 之前插入代码 */
  private injectBeforeMainEnd(shader: string, code: string): string {
    return injectBeforeMainEndFn(shader, code);
  }

  /** 根据 JS 值推断 GLSL 类型 */
  private inferGLSLType(value: unknown): string | null {
    return inferGLSLTypeFn(value);
  }

  /** 每帧更新注入的 uniform 值 */
  private updateInjectionUniforms(dt: number): void {
    if (this._shaderInjections.size === 0 || !this.spark) return;

    const material = this.spark.material as THREE.ShaderMaterial;
    if (!material?.uniforms) return;

    for (const [id, injection] of this._shaderInjections) {
      if (!injection.onUpdate) continue;

      const localUniforms = this._injectionUniforms.get(id);
      if (!localUniforms) continue;

      // 调用用户的 onUpdate 回调, 传入本地 uniform 值引用
      injection.onUpdate(localUniforms, dt);

      // 将更新后的值同步到材质 uniforms
      for (const [key, uniform] of Object.entries(localUniforms)) {
        if (material.uniforms[key]) {
          material.uniforms[key].value = uniform.value;
        }
      }
    }
  }

  destroy(): void {
    this.stop();
    this._sogStreamer?.abort();
    this._sogStreamer = undefined;
    this._keyboard.teardown();
    this.ro?.disconnect();
    this.ro = undefined;
    if (this.currentSplat) {
      this.scene?.remove(this.currentSplat);
      this.currentSplat.dispose();
      this.currentSplat = undefined;
    }
    this._compiledMaterials.clear();
    this.controls?.dispose();
    this.controls = undefined;
    this.spark?.parent?.remove(this.spark);
    this.spark?.dispose();
    this.spark = undefined;

    // ★ H2: 移除 context lost/restore 事件监听 (需在 renderer dispose 前执行)
    if (this._contextLostHandler && this.renderer) {
      this.renderer.domElement?.removeEventListener('webglcontextlost', this._contextLostHandler);
      this._contextLostHandler = undefined;
    }
    if (this._contextRestoredHandler && this.renderer) {
      this.renderer.domElement?.removeEventListener('webglcontextrestored', this._contextRestoredHandler);
      this._contextRestoredHandler = undefined;
    }

    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.renderer = undefined;
    this._frameCallbacks.clear();

    // ★ H3: 清理 FrustumCulling
    this._frustumCulling = undefined;

    this._destroyed = true;
  }

  // ─── 访问器 ──────────────────────────────────────────────

  getDeviceProfile(): DeviceProfile {
    return this.deviceProfile;
  }

  // ★ H4: 暴露 BufferPool 统计信息, 便于性能分析
  getBufferPoolStats() {
    return this._bufferPool.getStats();
  }

  getResolutionScale(): number {
    return this.adaptive?.currentResolutionScale ?? this.resolutionScale;
  }

  /** LOD 树是否已构建完成 */
  isLodReady(): boolean {
    return this._lodReady;
  }

  /**
   * ★ M2 衍生: 获取预构建 SOG LOD 层级
   *
   * @returns LOD 层级数组 (累计 splat 数), 或 undefined 表示无预构建 LOD
   *
   * 层级含义:
   *   levels[0] = 最粗 LOD (最少 splats, 远距离使用)
   *   levels[last] = 全部 splats (近距离使用)
   *
   * 可用于实现基于距离的自适应 LOD 切换:
   *   1. 计算摄像机到场景中心的距离
   *   2. 根据距离选择合适的 LOD 层级
   *   3. 截取 SplatMesh 数据为该层级的 splat 数
   */
  getSogLodLevels(): number[] | undefined {
    return this._sogLodLevels;
  }

  /** ★ M2 衍生: 获取 LOD 缩减因子 */
  getSogLodBase(): number | undefined {
    return this._sogLodBase;
  }

  // ─── 内部方法 ────────────────────────────────────────────

  private updateRenderSize(): void {
    if (!this.renderer || !this.spark) return;

    const scale = this.adaptive?.currentResolutionScale ?? this.resolutionScale;
    this.renderWidth = Math.round(this.cssWidth * scale);
    this.renderHeight = Math.round(this.cssHeight * scale);

    this.spark.renderSize.set(this.renderWidth, this.renderHeight);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);
  }

  private onResolutionChanged(scale: number): void {
    this.resolutionScale = scale;
    this.updateRenderSize();
  }

  static isCrossOriginIsolated(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
  }

  // ─── Bug 2: 摄像机自动定位 ───────────────────────────────

  /**
   * 基于 SplatMesh 的包围盒自动定位摄像机
   *
   * 将摄像机放置在场景中心, 朝向水平方向,
   * 距离基于包围盒大小自动计算。
   * 同时根据场景大小自适应移动速度。
   */
  private positionCameraToBounds(mesh: SplatMesh): void {
    if (!this.camera || !this.controls) return;

    try {
      // 获取 mesh 的局部包围盒, 再变换到世界空间 (考虑 rotation)
      mesh.updateMatrixWorld();
      const localBox = mesh.getBoundingBox(true);
      const worldBox = localBox.clone().applyMatrix4(mesh.matrixWorld);

      const center = new THREE.Vector3();
      worldBox.getCenter(center);

      const size = new THREE.Vector3();
      worldBox.getSize(size);

      const maxDim = Math.max(size.x, size.y, size.z);

      // ★ 摄像机放在场景中心 (Y 取中心高度, 水平面朝向)
      this.camera.position.set(center.x, center.y, center.z);

      // ★ 用 DragLookControls.lookAt 朝向 -Z 方向 (水平)
      this.controls.lookAt(center.x, center.y, center.z - 1);

      // 更新裁剪面
      const farPlane = Math.max(maxDim * 10, 1000);
      this.camera.far = farPlane;
      this.camera.near = Math.max(maxDim * 0.001, 0.01);
      this.camera.updateProjectionMatrix();

      // ★ 根据场景大小自适应移动速度
      // 每秒移动场景最大维度的 6%, 保底 5.0
      this._keyboard.setMoveSpeed(Math.max(maxDim * 0.06, 5.0));
      this._keyboard.setVerticalSpeed(Math.max(maxDim * 0.04, 3.0));

      // ★ 根据场景大小自适应滚轮速度
      this.controls.setWheelSpeed(Math.max(maxDim * 0.005, 0.5));

      this.controls.update();

      console.info(
        `[RenderManager] 摄像机已定位: pos=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}), ` +
        `sceneSize=${maxDim.toFixed(2)}, moveSpeed=${this._keyboard.moveSpeed.toFixed(1)}`,
      );
    } catch (err) {
      console.warn('[RenderManager] 摄像机自动定位失败:', err);
    }
  }

  // ─── Bug 4: LOD 树构建 ───────────────────────────────────

  /**
   * 加载后构建 LOD 树
   *
   * .splat 格式是扁平的 (无内置 LOD 层级)。
   * Spark 的 enableLod 默认 true, 但 LOD 驱动代码检查
   * packedSplats.lodSplats — 对扁平文件为 null, LOD 不会生效。
   *
   * 调用 createLodSplats() 从现有数据构建 LOD 层级,
   * 使 Spark 的 LOD 系统能够根据距离动态调整 splat 数量。
   *
   * P0 优化: 根据设备分级传入 quality 参数
   *   - LOW/MEDIUM: quality=false (更快构建, 更激进裁剪)
   *   - HIGH/ULTRA: quality=true (高质量 LOD)
   *
   * [来源: Spark 源码 — spark.module.js: this.enableLod = options.enableLod ?? true]
   * [来源: Spark 类型 — SplatMesh.createLodSplats({ rgbaArray?, quality?: boolean })]
   */
  private async buildLod(mesh: SplatMesh): Promise<void> {
    try {
      await mesh.createLodSplats({ quality: this.tierSettings.lodQuality });
      this._lodReady = true;
      console.info(`[RenderManager] LOD 树构建完成 (quality=${this.tierSettings.lodQuality})`);
    } catch (err) {
      console.warn('[RenderManager] LOD 树构建失败 (不影响基础渲染):', err);
      this._lodReady = false;
    }
  }

  /**
   * ★ P1-3: 非阻塞式 LOD 构建
   *
   * 与 buildLod() 的区别:
   *   - buildLod(): await → 阻塞 loadScene Promise (用于 .splat 直加载)
   *   - buildLodNonBlocking(): 不 await → 用户立即可交互 (用于 SOG 流式加载)
   *
   * ★ M2 衍生: 预构建 LOD 驱动集成
   *
   * 若 SOG 元数据包含 lodLevels (M2 预构建 LOD 索引), 跳过 Spark WASM
   * createLodSplats() 调用 (节省 8-80 秒构建时间), 直接标记 LOD 就绪。
   *
   * 预构建 LOD 层级基于 Morton 排序的前缀子集, 存储在 SOG 文件中。
   * levels[0] = 最粗 LOD (最少数 splats), levels[last] = 全部 splats。
   *
   * 注意: 跳过 createLodSplats() 意味着 Spark 内置 LOD 驱动不生效,
   * 渲染器将渲染全量 splats (最高质量)。预构建 LOD 层级通过
   * getSogLodLevels() 暴露, 供未来基于距离的自适应 LOD 切换使用。
   *
   * 若无预构建 LOD (旧版 SOG 或 lodTreeSize=0), 回退到 createLodSplats()。
   *
   * [来源: Spark 源码 — createLodSplats 在 Web Worker 中执行, 耗时 8-80s]
   * [来源: SOG LOD 格式 — packages/convert/src/sog-writer.ts buildLodLevels()]
   * [来源: 基准测试 — benchmarks/reports/benchmark-report.md LOD 构建日志]
   */
  private buildLodNonBlocking(mesh: SplatMesh, metadata: SogMetadata | null): void {
    // ★ M2 衍生: 预构建 LOD 集成
    //
    // Option A (修复性能回归): 即使有预建 LOD Levels 仍调用 createLodSplats()
    // 原因: 跳过 WASM 调用会禁用 Spark 的 LOD 消隐机制 → 场景过大时帧率暴跌 (27→2 FPS)
    //
    // Option B (原方案): 完全跳过 createLodSplats() 并使用自定义 LOD 切换 (开发量大)
    //
    // 当前选择 Option A: 保留预建 LOD 对快速初始化的优势 (节省 buildLodLevels 计算),
    // 同时确保 Spark 的 LOD 系统持续生效 (消隐)。
    //
    // 预建 levels 仍通过 getSogLodLevels() 暴露, 供未来质量提示使用。
    //
    // [来源: 基准测试 — benchmarks/reports/benchmark-report.md SOG Garden FPS 27.0→2.1]

    // 始终调用 createLodSplats() 以确保 LOD 消隐生效
    const useSogQuality = metadata && metadata.lodQuality !== undefined;
    const quality = useSogQuality
      ? metadata!.lodQuality === 1
      : this.tierSettings.lodQuality;

    // 若存在预建 LOD 数据, 缓存并日志提示
    if (metadata?.lodLevels && metadata.lodLevels.length > 0) {
      this._sogLodLevels = metadata.lodLevels;
      this._sogLodBase = metadata.lodBase;
      const levelsStr = metadata.lodLevels
        .map(n => n.toLocaleString())
        .join(' → ');
      console.info(
        `[RenderManager] 预构建 LOD 就绪: ` +
        `${metadata.lodLevels.length} 层, base=${metadata.lodBase?.toFixed(2) ?? '?'}, ` +
        `层级=[${levelsStr}] (仍调用 WASM 以保消隐)`,
      );
    }

    // 非阻塞: 不 await, 立即返回
    mesh.createLodSplats({ quality })
      .then(() => {
        this._lodReady = true;
        console.info(
          `[RenderManager] LOD 树非阻塞构建完成 (quality=${quality}, ` +
          `source=${useSogQuality ? 'SOG' : 'tier'})`,
        );
      })
      .catch((err) => {
        console.warn('[RenderManager] LOD 树非阻塞构建失败 (不影响基础渲染):', err);
        this._lodReady = false;
      });
  }

  // ─── 键盘移动控制 (★ M4: 委托共享模块) ─────────────────

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
}

// 向后兼容: 导出 ThreeRenderer 作为 RenderManager 的别名
export const ThreeRenderer = RenderManager;

// ─── WebGPU 检测 + 渲染器工厂 ──────────────────────────────
export { detectWebGPU, isWebGPUMaybeAvailable } from './webgpu-detector.js';
export type { WebGPUCapability, GpuType, WebGPULimits, TextureCompressionSupport } from './webgpu-detector.js';

export { createRenderer, createRendererSync } from './renderer-factory.js';
export type {
  RendererBackend,
  CreateRendererOptions,
  CreateRendererResult,
} from './renderer-factory.js';

// ─── SOG 流式 LOD ──────────────────────────────────────────
export { SogStreamer } from './sog-streamer.js';
export type {
  SogStreamerOptions,
  SogMetadata,
  SogChunkEntry,
} from './sog-streamer.js';

// ─── SPZ Worker 解码 ──────────────────────────────────────
export { decodeSpzInWorker, decodeSpz, parseSpzHeader, validateSpzHeader, SPZ_MAGIC, SPZ_VERSION } from './spz-decoder-worker.js';
export type { SpzHeader } from './spz-decoder-worker.js';

// ─── P2-1: 视锥剔除预处理 ─────────────────────────────────
export { SpatialGrid, FrustumCulling } from './frustum-culling.js';
export type { SpatialCell, VisibleRange } from './frustum-culling.js';

// ─── P2-2: Buffer 池化复用 ────────────────────────────────
export { SplatBufferPool } from './buffer-pool.js';
export type { BufferPoolStats, BufferPoolOptions } from './buffer-pool.js';

// ─── P3-1: WebGPU 渲染后端 ────────────────────────────────
export { WebGPURenderManager } from './webgpu-render-manager.js';
export type { WebGPURenderManagerOptions } from './webgpu-render-manager.js';

// ─── P3-2: WebGPU Compute Shader 排序 ─────────────────────
export { WebGPUSortManager } from './webgpu-sort-manager.js';
export type { WebGPUSortManagerOptions, SortResult } from './webgpu-sort-manager.js';
