/**
 * RendererAdapter — 渲染器抽象接口
 *
 * 将 TourPlayer 与具体渲染后端解耦。
 * TourPlayer 不直接依赖 Three.js / WebGL / WebGPU，
 * 所有交互通过此接口完成。
 *
 * v4.1 变更: 新增 onFrame()、getDeviceTier()、setResolutionScale()
 */

/** 设备分级 — 决定渲染参数 */
export enum DeviceTier {
  LOW,     // 250K splats, 0.5x 分辨率, SH 0
  MEDIUM,  // 500K splats, 0.75x 分辨率, SH 0
  HIGH,    // 1M splats, 1.0x 分辨率, SH 1
  ULTRA,   // 2M+ splats, 1.0x 分辨率, SH 2
}

/** 场景加载选项 */
export interface LoadOptions {
  onProgress?: (loaded: number, total: number) => void;
  shDegree?: number;
  maxSplats?: number;
  /**
   * SOG 流式 LOD URL (可选)。
   * 若提供，渲染器将使用 SogStreamer 分块流式加载，
   * 首帧快速渲染，后续 chunk 逐步补充细节。
   * 若未提供或加载失败，回退到 source 直接加载。
   */
  lodSource?: string;
}

// ─── Shader 注入 API ───────────────────────────────────────

/** Shader 注入位置 — 对应 GLSL 着色器的关键插入点 */
export enum ShaderHookPoint {
  /** 顶点着色器: main() 开头 */
  VERTEX_MAIN_BEGIN = 'vertex_main_begin',
  /** 顶点着色器: 计算位置后, gl_Position 赋值前 */
  VERTEX_BEFORE_POSITION = 'vertex_before_position',
  /** 顶点着色器: main() 结尾 */
  VERTEX_MAIN_END = 'vertex_main_end',
  /** 片段着色器: main() 开头 */
  FRAGMENT_MAIN_BEGIN = 'fragment_main_begin',
  /** 片段着色器: 颜色计算后, 最终输出前 */
  FRAGMENT_BEFORE_OUTPUT = 'fragment_before_output',
  /** 片段着色器: main() 结尾 */
  FRAGMENT_MAIN_END = 'fragment_main_end',
}

/** Shader 注入定义 */
export interface ShaderInjection {
  /** 唯一标识符 (用于移除) */
  id: string;
  /** 注入位置 */
  hook: ShaderHookPoint;
  /** 注入的 GLSL 代码 (会被插入到对应位置) */
  code: string;
  /** 额外的 uniform 声明 (可选, 如 'uniform float uTime;' ) */
  uniforms?: Record<string, unknown>;
  /** 每帧更新 uniform 值的回调 (可选) */
  onUpdate?: (uniforms: Record<string, unknown>, deltaTime: number) => void;
}

export interface RendererAdapter {
  /** 挂载到 DOM 容器 */
  mount(container: HTMLElement): void;

  /** 开始渲染（单一 RAF 循环由渲染器管理） */
  start(): void;

  /** 停止渲染循环 */
  stop(): void;

  /** 加载并渲染一个 splat 场景文件 */
  loadScene(source: string, options?: LoadOptions): Promise<void>;

  /** 获取当前相机视图投影矩阵 (16 元素) */
  getViewProjectionMatrix(): Float32Array;

  /** 获取当前相机世界坐标 */
  getCameraPosition(): { x: number; y: number; z: number };

  /** 获取视口尺寸 */
  getSize(): { width: number; height: number };

  /** 获取设备分级 */
  getDeviceTier(): DeviceTier;

  /** 设置渲染分辨率缩放比 */
  setResolutionScale(scale: number): void;

  /**
   * 注册每帧回调（插件更新等挂载在此，避免双 RAF）
   * 返回取消注册函数
   */
  onFrame(callback: (deltaTime: number) => void): () => void;

  /**
   * ★ Shader 注入 — 添加自定义 GLSL 代码到渲染管线
   *
   * 允许在不修改 Spark 核心代码的前提下, 向顶点/片段着色器注入自定义代码。
   * 常用于: 后处理效果、颜色调整、动画效果、自定义光照等。
   *
   * @example
   * ```typescript
   * renderer.addShaderInjection({
   *   id: 'color-shift',
   *   hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
   *   code: 'gl_FragColor.rgb = vec3(gl_FragColor.r, gl_FragColor.g * 0.8, gl_FragColor.b * 1.2);',
   * });
   * ```
   */
  addShaderInjection(injection: ShaderInjection): void;

  /** 移除 Shader 注入 */
  removeShaderInjection(id: string): void;

  /** 销毁释放所有 GPU 资源 */
  destroy(): void;
}
