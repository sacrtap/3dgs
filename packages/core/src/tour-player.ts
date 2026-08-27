/**
 * TourPlayer — 3DGS 漫游播放器 (纯基础设施)
 *
 * v4.1 重构:
 * - 移除 HotspotManager 硬编码 — 热点等领域功能由插件提供
 * - 移除独立 RAF 循环 — 通过 renderer.onFrame() 挂载到渲染器单一 RAF
 * - emit() 公开化 — 供插件间通信使用
 * - 新增 PluginSystem — 管理插件生命周期和每帧更新
 *
 * 职责: 帧循环管理 + 场景切换 + 插件编排 + 事件总线
 * 不感知热点、不感知任何领域功能
 */

import { TourLoader, type TourRuntime } from './tour-loader.js';
import { SceneManager, type SceneEvent } from './scene-manager.js';
import { PluginSystem, type TourPlugin } from './plugin-system.js';
import type { SceneTransition, TourConfig } from './tour-config.js';
import type { RendererAdapter } from './renderer-adapter.js';

export type TourPlayerEventType =
  | SceneEvent['type']
  | 'hotspot:click' | 'hotspot:hover'
  | 'scene:switching' | 'scene:switched'
  | 'load' | 'error';

export type TourPlayerHandler = (data: unknown) => void;

export class TourPlayer {
  private container: HTMLElement;
  private loader = new TourLoader();
  private runtime: TourRuntime | null = null;
  private sceneManager?: SceneManager;
  private renderer?: RendererAdapter;
  private plugins = new PluginSystem();

  private listeners = new Map<string, Set<TourPlayerHandler>>();
  private _loaded = false;
  private _destroyed = false;
  private _frameUnsub?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** 挂载渲染器（在 load 前调用; 已加载后调用则为切换渲染器） */
  setRenderer(renderer: RendererAdapter): void {
    this.renderer = renderer;
    renderer.mount(this.container);

    // ★ 修复: 已加载状态下切换渲染器 (如 demo 后端切换) 时重新注册帧回调。
    //   旧回调挂在已销毁的渲染器上, 不重挂会导致插件 (热点投影/过渡等) 停更。
    if (this._loaded) {
      this._frameUnsub?.();
      this._frameUnsub = renderer.onFrame((dt) => {
        this.onFrame(dt);
      });
    }
  }

  /** 注册插件（需在 load 前调用） */
  use(plugin: TourPlugin): this {
    this.plugins.register(plugin, this);
    return this;
  }

  /** 加载漫游配置并启动渲染 */
  async load(config: string | TourConfig): Promise<void> {
    // ★ D-13: 校验已销毁实例 — _destroyed 从"置位后从未读取"变为真实防护,
    //   避免组件卸载后异步回调仍向已销毁播放器加载场景导致资源泄漏/异常
    if (this._destroyed) {
      throw new Error('TourPlayer 已销毁, 无法加载');
    }
    try {
      const runtime: TourRuntime = typeof config === 'string'
        ? await this.loader.load(config)
        : this.loader.fromObject(config);

      this.runtime = runtime;
      this.sceneManager = runtime.sceneManager;
      this._loaded = true;

      this.renderer?.start();

      // ★ 通过 onFrame 回调挂载到渲染器的单一 RAF 循环
      // 不再创建独立的 RAF 循环
      this._frameUnsub = this.renderer?.onFrame((dt) => {
        this.onFrame(dt);
      });

      this.emit('load', { sceneCount: this.sceneManager.list().length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', { message: msg });
      throw err;
    }
  }

  /** 切换场景 */
  async switchScene(id: string, transition?: Partial<SceneTransition>): Promise<void> {
    if (!this.sceneManager) throw new Error('TourPlayer 未加载');
    if (this._destroyed) throw new Error('TourPlayer 已销毁, 无法切换场景');

    // ★ 发出场景切换前事件 — 过渡动画插件监听此事件执行 fade-out
    this.emit('scene:switching', { sceneId: id, transition });

    await this.sceneManager.switchTo(id, transition);

    const scene = this.sceneManager.get(id);
    if (this.renderer && scene) {
      const defaults = this.sceneManager.getMergedDefaults();

      // ★ 传递 lodSource + defaults 中的 camera/quality 配置
      await this.renderer.loadScene(scene.config.source, {
        lodSource: scene.config.lodSource,
        shDegree: defaults?.quality?.shDegree,
        maxSplats: defaults?.quality?.maxSplats,
      });

      // ★ 应用 camera 默认值 (fov / pitch 限制)
      if (defaults?.camera) {
        this.emit('camera:defaults', { camera: defaults.camera });
      }
    }

    // ★ 发出场景切换事件 — 热点插件等监听此事件加载对应配置
    this.emit('scene:switched', { sceneId: id, scene });
  }

  // ─── 每帧回调 (由渲染器的 RAF 循环驱动) ──────────────────

  private onFrame(deltaTime: number): void {
    if (!this.renderer || !this._loaded) return;

    const cam = this.renderer.getCameraPosition();
    const vp = this.renderer.getViewProjectionMatrix();
    const size = this.renderer.getSize();

    // 插件更新（热点插件在此回调中自行执行可见性计算）
    this.plugins.update(deltaTime, {
      camera: cam,
      vpMatrix: vp,
      size,
      sceneManager: this.sceneManager,
    });
  }

  // ─── 事件系统 ────────────────────────────────────────────

  on(type: TourPlayerEventType | string, handler: TourPlayerHandler): () => void {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(handler);
    return () => this.listeners.get(key)?.delete(handler);
  }

  /** 触发事件（供插件间通信使用） */
  emit(type: string, data?: unknown): void {
    this.listeners.get(type)?.forEach((h) => {
      try {
        h(data);
      } catch {
        /* 安全 */
      }
    });
  }

  // ─── 访问器 (供插件使用) ──────────────────────────────────

  getSceneManager(): SceneManager | undefined {
    return this.sceneManager;
  }

  getRenderer(): RendererAdapter | undefined {
    return this.renderer;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  isLoaded(): boolean {
    return this._loaded;
  }

  // ─── 销毁 ────────────────────────────────────────────────

  destroy(): void {
    this._destroyed = true;
    this._frameUnsub?.();
    this._frameUnsub = undefined;
    this.plugins.destroyAll();
    this.renderer?.destroy();
    this.loader.abort();
    this.sceneManager?.destroy();
    this.listeners.clear();
    this.runtime = null;
    this._loaded = false;
  }
}
