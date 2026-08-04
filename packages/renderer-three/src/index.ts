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
import { DragLookControls } from './drag-look-controls.js';
import { injectAfterMainBegin as injectAfterMainBeginFn, injectBeforePattern as injectBeforePatternFn, injectBeforeMainEnd as injectBeforeMainEndFn, inferGLSLType as inferGLSLTypeFn } from './shader-utils.js';

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

  // 帧回调 (替代双 RAF)
  private frameCallbacks = new Set<(deltaTime: number) => void>();

  // 矩阵缓存
  private vpMatrix = new Float32Array(16);
  private camPos = { x: 0, y: 0, z: 0 };
  private tmpV3 = new THREE.Vector3();
  private tmpM4 = new THREE.Matrix4();

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

  // 键盘移动控制
  private keysDown = new Set<string>();
  private _enableKeyboard: boolean;
  private _moveSpeed: number;
  private _verticalSpeed: number;
  private _keyHandler?: (e: KeyboardEvent) => void;
  private _keyUpHandler?: (e: KeyboardEvent) => void;
  private _blurHandler?: () => void;

  // ★ 速度平滑: 当前速度向量 (连续指数插值)
  private _currentVel = new THREE.Vector3();
  private _targetVel = new THREE.Vector3();

  // 坐标矫正 & LOD
  private _autoOrient: boolean;
  private _enableLod: boolean;
  private _lodReady = false;

  // ★ SOG 流式加载器 (用于 abort)
  private _sogStreamer?: SogStreamer;

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
    this._enableKeyboard = options.enableKeyboardControls ?? true;
    this._moveSpeed = options.moveSpeed ?? 5.0;
    this._verticalSpeed = options.verticalSpeed ?? 3.0;
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

    const spark = new SparkRenderer({ renderer });
    spark.renderSize.set(this.cssWidth, this.cssHeight);
    scene.add(spark);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.spark = spark;
    this._running = true;

    this.updateRenderSize();

    if (this._enableKeyboard) {
      this.setupKeyboardControls();
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

      // ★ 键盘移动 (连续指数平滑, 在 controls.update 前应用)
      this.applyKeyboardMovement(dt);

      controls.update();
      renderer.render(scene, camera);

      // 更新矩阵缓存
      this.tmpM4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.tmpM4.toArray(this.vpMatrix);
      camera.getWorldPosition(this.tmpV3);
      this.camPos.x = this.tmpV3.x;
      this.camPos.y = this.tmpV3.y;
      this.camPos.z = this.tmpV3.z;

      // 帧回调
      for (const cb of this.frameCallbacks) {
        try {
          cb(dt);
        } catch {
          /* 安全 */
        }
      }

      // ★ Shader 注入 uniform 更新
      this.updateInjectionUniforms(dt);

      this.adaptive?.sample();

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

    // 直接加载 source (原有逻辑)
    return new Promise<void>((resolve, reject) => {
      new SplatMesh({
        url: source,
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

          // ★ Bug 4 修复: 构建 LOD 树
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
   * ★ SOG 流式加载 — 首帧快速渲染 + 渐进补全
   *
   * 工作流程:
   *   1. SogStreamer 获取 header + chunk index
   *   2. 加载第一个 chunk → 从 .splat 数据创建 SplatMesh → 立即渲染 (首帧)
   *   3. 继续加载剩余 chunk → 累积数据
   *   4. 所有 chunk 加载完成 → 用完整数据替换 SplatMesh (补全细节)
   *
   * [来源: SOG 格式 — packages/convert/src/sog-writer.ts]
   * [来源: SplatMesh fileBytes API — @sparkjsdev/spark SplatMeshOptions]
   */
  private async loadSceneWithSog(
    lodSource: string,
    options?: LoadOptions,
  ): Promise<void> {
    const chunkDataList: ArrayBuffer[] = [];
    let metadata: SogMetadata | null = null;
    let firstMeshReady = false;

    const streamer = new SogStreamer({
      url: lodSource,
      onProgress: (loadedChunks, totalChunks, loadedSplats, totalSplats) => {
        if (options?.onProgress) {
          options.onProgress(loadedSplats, totalSplats);
        }
      },
      onChunkLoaded: (chunkIndex, data, _count) => {
        chunkDataList[chunkIndex] = data;

        // ★ 首个 chunk 到达 → 立即创建 SplatMesh 渲染 (首帧快速显示)
        if (!firstMeshReady && chunkIndex === 0) {
          firstMeshReady = true;
          new SplatMesh({
            fileBytes: new Uint8Array(data),
            fileType: SplatFileType.SPLAT,
            onLoad: async (loadedMesh: SplatMesh) => {
              if (this._autoOrient) {
                loadedMesh.rotation.x = Math.PI;
              }
              this.scene!.add(loadedMesh);
              this.currentSplat = loadedMesh;
              this.positionCameraToBounds(loadedMesh);
              if (this._enableLod) {
                this.buildLod(loadedMesh);
              }
              // ★ 应用 Shader 注入
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

    // 启动流式加载 (会阻塞到所有 chunk 加载完成)
    metadata = await streamer.start();

    // ★ 所有 chunk 加载完成 → 用完整数据替换 SplatMesh
    if (this.currentSplat) {
      this.scene!.remove(this.currentSplat);
      this.currentSplat.dispose();
      this.currentSplat = undefined;
    }

    // 拼接所有 chunk 数据为完整的 .splat buffer
    const totalBytes = chunkDataList.reduce((sum, buf) => sum + buf.byteLength, 0);
    const fullBuffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunkDataList) {
      fullBuffer.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    // 用完整数据创建最终 SplatMesh
    await new Promise<void>((resolve, reject) => {
      new SplatMesh({
        fileBytes: fullBuffer,
        fileType: SplatFileType.SPLAT,
        onLoad: async (loadedMesh: SplatMesh) => {
          if (this._autoOrient) {
            loadedMesh.rotation.x = Math.PI;
          }
          this.scene!.add(loadedMesh);
          this.currentSplat = loadedMesh;
          this.positionCameraToBounds(loadedMesh);
          if (this._enableLod) {
            this.buildLod(loadedMesh);
          }
          // ★ 应用 Shader 注入
          this.applyInjectionsToMaterial();
          resolve();
        },
      });

      // 超时保护 (10s)
      setTimeout(() => {
        reject(new Error('SOG 完整 mesh 创建超时'));
      }, 10000);
    });

    console.info(
      `[RenderManager] SOG 流式加载完成: ${metadata.numSplats.toLocaleString()} splats, ` +
      `${metadata.numChunks} chunks`,
    );
  }

  getViewProjectionMatrix(): Float32Array {
    return this.vpMatrix;
  }

  getCameraPosition(): { x: number; y: number; z: number } {
    return this.camPos;
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
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
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

    // 需要重新编译材质 (移除注入)
    if (this.spark) {
      this._compiledMaterials.delete(this.spark.material);
      this.spark.material.needsUpdate = true;
      this.applyInjectionsToMaterial();
    }
  }

  /**
   * 将所有 Shader 注入应用到 SparkRenderer 的材质
   *
   * SparkRenderer 继承自 THREE.Mesh, 拥有 readonly material: THREE.ShaderMaterial。
   * 通过 Three.js 的 onBeforeCompile 机制注入 GLSL 代码:
   *   - 在 shader 编译前替换 shader 源码字符串
   *   - 注入自定义 uniform
   *   - 每帧通过 material.uniforms 更新 uniform 值
   *
   * [来源: SparkRenderer 类型 — @sparkjsdev/spark SparkRenderer.d.ts]
   * [来源: Three.js 文档 — WebGLProgram / onBeforeCompile]
   */
  private applyInjectionsToMaterial(): void {
    if (!this.spark) return;
    const material = this.spark.material as THREE.ShaderMaterial;
    if (!material) return;

    // 避免重复绑定 onBeforeCompile
    if (this._compiledMaterials.has(material)) return;
    this._compiledMaterials.add(material);

    const injections = Array.from(this._shaderInjections.values());
    if (injections.length === 0) return;

    // 合并所有注入的 uniforms
    const allUniforms: Record<string, THREE.IUniform> = {};
    for (const [, uniforms] of this._injectionUniforms) {
      Object.assign(allUniforms, uniforms);
    }

    // 对于 ShaderMaterial, 直接修改 vertexShader/fragmentShader 和 uniforms
    // ShaderMaterial 不触发 onBeforeCompile, 而是直接使用其 shader 源码
    // 所以我们需要直接修改 material.vertexShader / fragmentShader / uniforms

    // 保存原始 shader (仅在第一次注入时)
    if (!(material as unknown as { _originalVertexShader?: string })._originalVertexShader) {
      (material as unknown as { _originalVertexShader?: string })._originalVertexShader = material.vertexShader;
      (material as unknown as { _originalFragmentShader?: string })._originalFragmentShader = material.fragmentShader;
    }

    const origVS = (material as unknown as { _originalVertexShader: string })._originalVertexShader;
    const origFS = (material as unknown as { _originalFragmentShader: string })._originalFragmentShader;

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
          // 匹配 gl_FragColor 或 fragColor 或 pc_fragColor
          fs = this.injectBeforePattern(fs, /(gl_FragColor|fragColor|pc_fragColor)\s*=/, code);
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
    this.teardownKeyboardControls();
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
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.renderer = undefined;
    this.frameCallbacks.clear();
    this._destroyed = true;
  }

  // ─── 访问器 ──────────────────────────────────────────────

  getDeviceProfile(): DeviceProfile {
    return this.deviceProfile;
  }

  getResolutionScale(): number {
    return this.adaptive?.currentResolutionScale ?? this.resolutionScale;
  }

  /** LOD 树是否已构建完成 */
  isLodReady(): boolean {
    return this._lodReady;
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
      this._moveSpeed = Math.max(maxDim * 0.06, 5.0);
      this._verticalSpeed = Math.max(maxDim * 0.04, 3.0);

      // ★ 根据场景大小自适应滚轮速度
      this.controls.setWheelSpeed(Math.max(maxDim * 0.005, 0.5));

      this.controls.update();

      console.info(
        `[RenderManager] 摄像机已定位: pos=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}), ` +
        `sceneSize=${maxDim.toFixed(2)}, moveSpeed=${this._moveSpeed.toFixed(1)}`,
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
   * [来源: Spark 源码 — spark.module.js: this.enableLod = options.enableLod ?? true]
   * [来源: Spark 类型 — SplatMesh.createLodSplats({ rgbaArray?, quality? })]
   */
  private async buildLod(mesh: SplatMesh): Promise<void> {
    try {
      await mesh.createLodSplats();
      this._lodReady = true;
      console.info('[RenderManager] LOD 树构建完成');
    } catch (err) {
      console.warn('[RenderManager] LOD 树构建失败 (不影响基础渲染):', err);
      this._lodReady = false;
    }
  }

  // ─── 键盘移动控制 ────────────────────────────────────────

  setKeyboardEnabled(enabled: boolean): void {
    this._enableKeyboard = enabled;
    if (enabled && this._running) {
      this.setupKeyboardControls();
    } else if (!enabled) {
      this.teardownKeyboardControls();
    }
  }

  setMoveSpeed(speed: number): void {
    this._moveSpeed = speed;
  }

  setVerticalSpeed(speed: number): void {
    this._verticalSpeed = speed;
  }

  getActiveMoveKeys(): string[] {
    return Array.from(this.keysDown);
  }

  private setupKeyboardControls(): void {
    if (this._keyHandler) return;

    this._keyHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (MOVE_KEYS.has(key)) {
        this.keysDown.add(key);
        e.preventDefault();
      }
    };

    this._keyUpHandler = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };

    this._blurHandler = () => {
      this.keysDown.clear();
    };

    window.addEventListener('keydown', this._keyHandler);
    window.addEventListener('keyup', this._keyUpHandler);
    window.addEventListener('blur', this._blurHandler);
  }

  private teardownKeyboardControls(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = undefined;
    }
    if (this._keyUpHandler) {
      window.removeEventListener('keyup', this._keyUpHandler);
      this._keyUpHandler = undefined;
    }
    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
      this._blurHandler = undefined;
    }
    this.keysDown.clear();
    this._currentVel.set(0, 0, 0);
  }

  /**
   * ★ 连续指数平滑移动 (替代固定时间步长)
   *
   * 原理:
   *   1. 按键状态 → 目标速度 (本地空间: x=右, y=上, z=前)
   *   2. 连续指数插值: currentVel += (targetVel - currentVel) × (1 - exp(-dt/τ))
   *      τ = 时间常数, 控制加速/减速的平滑程度
   *   3. 本地空间平移: camera.translateX/Y/Z (自动跟随相机朝向, 无需每帧重算方向向量)
   *
   * 优势:
   *   - 帧率无关: 30fps / 60fps / 144fps 下加速度曲线精确一致
   *   - 无量化跳变: 每帧连续更新, 不存在步长累加器的跳步问题
   *   - 方向无抖动: translateX/Y/Z 使用相机本地坐标系, 不受阻尼微调影响
   *
   * [来源: three/examples/jsm/controls/FirstPersonControls.js — translateX/Y/Z + lerp]
   * [来源: https://www.gamedeveloper.com/programming/frame-rate-independent-damping]
   */
  private applyKeyboardMovement(dtMs: number): void {
    if (!this.camera) return;

    const dt = dtMs / 1000;

    // ── 1. 计算目标速度 (本地空间) ──
    // x=右移, y=升降, z=前后 (负值=前进)
    this._targetVel.set(0, 0, 0);

    if (this.keysDown.size > 0) {
      // 前后 (W/S) → 本地 Z 轴
      if (this.keysDown.has('w')) {
        this._targetVel.z -= this._moveSpeed;
      }
      if (this.keysDown.has('s')) {
        this._targetVel.z += this._moveSpeed;
      }
      // 左右 (A/D) → 本地 X 轴
      if (this.keysDown.has('a')) {
        this._targetVel.x -= this._moveSpeed;
      }
      if (this.keysDown.has('d')) {
        this._targetVel.x += this._moveSpeed;
      }
      // 升降 (Q/E) → 世界 Y 轴 (不受相机朝向影响)
      if (this.keysDown.has('q')) {
        this._targetVel.y += this._verticalSpeed;
      }
      if (this.keysDown.has('e')) {
        this._targetVel.y -= this._verticalSpeed;
      }
    }

    // ── 2. 连续指数平滑 (帧率无关) ──
    // alpha = 1 - exp(-dt / τ)
    // τ = 时间常数 (秒), 约 63% 目标速度所需时间
    // dt=16.67ms, τ=0.08s → alpha≈0.19; dt=33ms(30fps) → alpha≈0.34 (自动补偿)
    //
    // 与 1-(1-s)^(dt*60) 的区别:
    //   旧公式是离散帧计数近似, 不同帧率下有微小误差
    //   exp(-dt/τ) 是连续物理模型, 任意 dt 下数学精确等价
    const alpha = 1 - Math.exp(-dt / MOVE_TIME_CONSTANT);
    this._currentVel.lerp(this._targetVel, alpha);

    if (this.keysDown.size === 0 && this._currentVel.lengthSq() < 1e-8) {
      this._currentVel.set(0, 0, 0);
      return;
    }

    // ── 3. 本地空间平移 ──
    // translateX/Y/Z 自动使用相机的本地坐标系
    // 无需每帧调用 getWorldDirection + crossVectors + normalize
    // 消除方向向量微变导致的位移抖动
    //
    // 注意: translateY 需要相机 up 向量 = 世界 Y 轴
    // (DragLookControls 使用 YXZ Euler, up 始终为 (0,1,0), 满足此条件)
    this.camera.translateX(this._currentVel.x * dt);
    this.camera.translateY(this._currentVel.y * dt);
    this.camera.translateZ(this._currentVel.z * dt);
  }
}

/** 移动平滑时间常数 (秒) — 控制加速/减速的平滑程度
 *  τ=0.08s: 约 80ms 达到 63% 目标速度, 约 240ms 达到 95%
 *  越小越灵敏, 越大越平滑
 */
const MOVE_TIME_CONSTANT = 0.08;

/** 支持的移动按键集合 */
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

// 向后兼容: 导出 ThreeRenderer 作为 RenderManager 的别名
export const ThreeRenderer = RenderManager;

// ─── WebGPU 检测 + 渲染器工厂 ──────────────────────────────
export { detectWebGPU, isWebGPUMaybeAvailable } from './webgpu-detector.js';
export type { WebGPUCapability } from './webgpu-detector.js';

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
