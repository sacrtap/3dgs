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

  /** 销毁释放所有 GPU 资源 */
  destroy(): void;
}
