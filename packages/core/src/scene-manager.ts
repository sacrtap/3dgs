import type { SceneConfig, SceneTransition, TourDefaults } from './tour-config.js';
import type { RendererAdapter } from './renderer-adapter.js';

export type SceneLoadState = 'unloaded' | 'loading' | 'loaded' | 'error';

export interface SceneInstance {
  id: string;
  config: SceneConfig & { defaults?: TourDefaults };
  state: SceneLoadState;
  loadError?: string;
  /** ★ TD-03: 预加载进行中标志 — 防止并发重复调用 renderer.preloadScene */
  preloading?: boolean;
}

export type SceneEventType = 'scene:loaded' | 'scene:error' | 'scene:switched' | 'scene:progress';

export interface SceneEvent {
  type: SceneEventType;
  sceneId: string;
  progress?: number;
  error?: string;
}

type EventHandler = (event: SceneEvent) => void;

export class SceneManager {
  private scenes = new Map<string, SceneInstance>();
  private listeners = new Map<SceneEventType, Set<EventHandler>>();
  private defaults?: TourDefaults;
  private currentSceneId: string | null = null;
  /** ★ TD-03/R-05: 渲染器引用 — 预加载真实触发 (bindRenderer 注入) */
  private renderer?: RendererAdapter;

  constructor(defaults?: TourDefaults) {
    this.defaults = defaults;
  }

  /**
   * ★ TD-03/R-05: 绑定渲染器 (TourPlayer.load 时注入)。
   * 绑定后 preload() 会真实调用渲染器的 preloadScene() 预取资源。
   */
  bindRenderer(renderer?: RendererAdapter): void {
    this.renderer = renderer;
  }

  register(id: string, config: SceneConfig & { defaults?: TourDefaults }): void {
    if (this.scenes.has(id)) {
      throw new Error(`场景 "${id}" 已注册`);
    }
    this.scenes.set(id, {
      id,
      config,
      state: 'unloaded',
    });
  }

  async loadScene(id: string): Promise<SceneInstance> {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(`场景 "${id}" 未注册`);

    if (scene.state === 'loaded') return scene;
    if (scene.state === 'loading') throw new Error(`场景 "${id}" 正在加载中`);

    scene.state = 'loading';
    this.emit({ type: 'scene:progress', sceneId: id, progress: 0 });

    try {
      const source = scene.config.source;
      if (!source) throw new Error(`场景 "${id}" 缺少 source`);

      // 实际 splat 加载由渲染适配器 (RendererAdapter.loadScene) 完成
      // SceneManager 仅管理场景元信息和状态
      this.emit({ type: 'scene:progress', sceneId: id, progress: 1 });

      scene.state = 'loaded';
      this.emit({ type: 'scene:loaded', sceneId: id });
      return scene;
    } catch (err) {
      scene.state = 'error';
      scene.loadError = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'scene:error', sceneId: id, error: scene.loadError });
      throw err;
    }
  }

  async switchTo(id: string, _transition?: Partial<SceneTransition>): Promise<void> {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(`场景 "${id}" 未注册`);

    if (scene.state !== 'loaded') {
      await this.loadScene(id);
    }

    this.currentSceneId = id;
    this.emit({ type: 'scene:switched', sceneId: id });
  }

  /** 预加载场景（后台静默加载） */
  async preload(id: string): Promise<void> {
    const scene = this.scenes.get(id);
    if (!scene || scene.state === 'loaded') return;

    // ★ 预加载去重: preloading 防并发重复调用 renderer.preloadScene
    //   注意: 渲染器 preloadScene 自带缓存去重 (_preloadCache.has), 成功后重复
    //   preload 不会重发网络请求 — 无需持久 preloaded 标记 (LRU 淘汰后还能重新预取)
    if (scene.preloading) return;

    // ★ TD-03: 端到端预加载 — 渲染器实现 preloadScene 时真实预取资源 (不切换可见场景);
    //   预取成功后场景仍保持 unloaded, switchTo 时 loadScene 命中渲染器缓存, 不重复下载。
    //   失败静默 — 切换时走正常加载路径兜底。
    if (this.renderer?.preloadScene && scene.config.source) {
      scene.preloading = true;
      try {
        await this.renderer.preloadScene(scene.config.source, {
          lodSource: scene.config.lodSource,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[SceneManager] 预加载场景 "${id}" 失败(切换时将重试): ${msg}`);
      } finally {
        scene.preloading = false;
      }
      return;
    }

    // 渲染器不支持预加载: 回退为状态标记 (旧行为);
    // ★ 加载中场景穿透到 loadScene 会抛 "正在加载中" — preload 语义应静默, 直接跳过
    if (scene.state === 'loading') return;
    await this.loadScene(id);
  }

  /**
   * 预加载指定场景列表
   * 热点插件可调用此方法预加载相邻场景
   */
  async preloadScenes(sceneIds: string[]): Promise<void> {
    // TD-14: Use allSettled to express "individual failures are OK" semantics
    await Promise.allSettled(sceneIds.map((id) => this.preload(id)));
  }

  getCurrent(): SceneInstance | null {
    if (!this.currentSceneId) return null;
    return this.scenes.get(this.currentSceneId) ?? null;
  }

  get(id: string): SceneInstance | undefined {
    return this.scenes.get(id);
  }

  list(): SceneInstance[] {
    return Array.from(this.scenes.values());
  }

  getCurrentId(): string | null {
    return this.currentSceneId;
  }

  /**
   * 获取合并后的默认配置 (defaults.camera + defaults.quality)
   * 供 TourPlayer 传递给渲染器
   */
  getMergedDefaults(): TourDefaults | undefined {
    return this.defaults;
  }

  // ─── 事件系统 ────────────────────────────────────────────

  on(type: SceneEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  private emit(event: SceneEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          /* 防止一个 handler 异常影响其他 */
        }
      }
    }
  }

  destroy(): void {
    this.listeners.clear();
    this.scenes.clear();
    this.currentSceneId = null;
    // ★ 清除 renderer 引用: 避免销毁后异步回调 (preload catch 路径) 操作已销毁对象
    this.renderer = undefined;
  }
}
