import type { SceneConfig, SceneTransition, TourDefaults } from './tour-config.js';

export type SceneLoadState = 'unloaded' | 'loading' | 'loaded' | 'error';

export interface SceneInstance {
  id: string;
  config: SceneConfig & { defaults?: TourDefaults };
  state: SceneLoadState;
  loadError?: string;
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

  constructor(defaults?: TourDefaults) {
    this.defaults = defaults;
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
    await this.loadScene(id);
  }

  /**
   * 预加载指定场景列表
   * 热点插件可调用此方法预加载相邻场景
   */
  async preloadScenes(sceneIds: string[]): Promise<void> {
    await Promise.all(
      sceneIds.map((id) => this.preload(id).catch(() => {})),
    );
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
  }
}
