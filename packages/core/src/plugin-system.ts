/**
 * PluginSystem — 插件系统
 *
 * v4.1 新增: 热点系统等领域功能以插件形式提供
 * 核心层通过此系统编排插件的生命周期和每帧更新
 */

import type { TourPlayer } from './tour-player.js';
import type { SceneManager } from './scene-manager.js';
import type { RendererAdapter } from './renderer-adapter.js';

/** 插件初始化时获得的上下文 */
export interface TourPluginContext {
  player: TourPlayer;
  sceneManager?: SceneManager;
  renderer?: RendererAdapter;
  container: HTMLElement;
}

/** 每帧更新时获得的数据 */
export interface FrameContext {
  camera: { x: number; y: number; z: number };
  vpMatrix: Float32Array;
  size: { width: number; height: number };
  sceneManager?: SceneManager;
  deltaTime: number;
}

/** 插件接口 */
export interface TourPlugin {
  name: string;
  version: string;

  /** 插件初始化 */
  init?(ctx: TourPluginContext): void;

  /** 每帧更新 */
  update?(ctx: FrameContext): void;

  /** 销毁 */
  destroy?(): void;
}

/** 插件系统 — 管理插件注册、更新、销毁 */
export class PluginSystem {
  private plugins: TourPlugin[] = [];
  private contexts = new Map<string, TourPluginContext>();

  /** 注册插件 */
  register(plugin: TourPlugin, player: TourPlayer): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      console.warn(`插件 "${plugin.name}" 已注册，跳过`);
      return;
    }
    this.plugins.push(plugin);

    const ctx: TourPluginContext = {
      player,
      sceneManager: player.getSceneManager(),
      renderer: player.getRenderer(),
      container: player.getContainer(),
    };
    this.contexts.set(plugin.name, ctx);
    plugin.init?.(ctx);
  }

  /** 每帧更新所有插件 */
  update(deltaTime: number, frameData: Omit<FrameContext, 'deltaTime'>): void {
    for (const plugin of this.plugins) {
      const ctx = this.contexts.get(plugin.name);
      if (!ctx) continue;
      plugin.update?.({ ...frameData, deltaTime });
    }
  }

  /** 销毁所有插件 */
  destroyAll(): void {
    for (const plugin of this.plugins) {
      try {
        plugin.destroy?.();
      } catch {
        /* 安全 */
      }
    }
    this.plugins = [];
    this.contexts.clear();
  }

  /** 获取已注册插件列表 */
  list(): readonly TourPlugin[] {
    return this.plugins;
  }
}
