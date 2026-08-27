/**
 * HotspotSystem — 热点系统插件
 *
 * v4.1: 从 @3dgs/core 完全解耦为独立插件
 *
 * 职责:
 *   1. 监听 scene:switched 事件，从 scene.extensions.hotspot 读取配置
 *   2. 每帧投影热点到屏幕坐标并更新可见性
 *   3. 路由热点点击事件 (含场景跳转)
 *   4. 自动预加载跳转目标场景
 */

import type { TourPlugin, FrameContext, TourPluginContext } from '@3dgs/core';
import { HotspotManager } from './hotspot-manager.js';
import type { HotspotExtension, HotspotConfig } from './hotspot-config.js';

export interface HotspotSystemOptions {
  /** 是否自动预加载场景跳转目标 (默认 true) */
  preloadTargets?: boolean;
}

/** 热点系统插件对外接口 (配置驱动 + 运行时增删/弹窗控制) */
export interface HotspotSystemPlugin extends TourPlugin {
  /** ★ 运行时添加热点 (同 id 替换; 不依赖场景配置, 适合编辑器/动态交互) */
  addHotspot(config: HotspotConfig): void;
  /** ★ 运行时移除热点 */
  removeHotspot(id: string): void;
  /** ★ 程序化打开某热点的弹出面板 */
  openPopup(id: string): boolean;
  /** ★ 关闭当前弹出面板 */
  closePopup(): void;
}

export function createHotspotSystem(options: HotspotSystemOptions = {}): HotspotSystemPlugin {
  const { preloadTargets = true } = options;

  let manager: HotspotManager;
  let ctx: TourPluginContext;
  let unsubSceneSwitched: (() => void) | undefined;

  const plugin: HotspotSystemPlugin = {
    name: 'hotspot-system',
    version: '0.1.0',

    init(pluginCtx) {
      ctx = pluginCtx;
      manager = new HotspotManager();

      // 注入 CSS 动画
      HotspotManager.injectStyles();

      // 创建热点叠加层
      const overlay = document.createElement('div');
      overlay.className = '3dgs-hotspot-overlay';
      Object.assign(overlay.style, {
        position: 'absolute',
        top: '0', left: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
      } as Partial<CSSStyleDeclaration>);
      ctx.container.appendChild(overlay);

      manager.attach(overlay);

      // 热点点击 → 场景跳转 or 事件转发
      manager.onClick((instance) => {
        const config = instance.config;

        // 转发到 TourPlayer 事件总线 (供 UI 层监听)
        ctx.player.emit('hotspot:click', {
          id: config.id,
          config,
          instance,
        });

        // ★ 点击弹出面板 (配置了 popup 的热点自动弹出)
        if (config.popup) {
          manager.openPopup(config.id);
          ctx.player.emit('hotspot:popup-open', {
            id: config.id,
            popup: config.popup,
          });
        }

        // 场景跳转热点
        if (config.type === 'scene' && config.targetScene) {
          ctx.player.switchScene(config.targetScene, config.transition).catch((err) => {
            console.error(`[HotspotSystem] 场景跳转失败: ${config.targetScene}`, err);
            ctx.player.emit('error', {
              message: `场景跳转失败: ${err instanceof Error ? err.message : String(err)}`,
            });
          });
        }

        // URL 热点
        if (config.type === 'url' && config.onClick?.url) {
          const target = config.onClick.target || '_blank';
          window.open(config.onClick.url, target, 'noopener,noreferrer');
        }
      });

      manager.onHover((instance) => {
        ctx.player.emit('hotspot:hover', {
          id: instance.config.id,
          config: instance.config,
        });
      });

      // ★ 弹出面板关闭事件转发 (遮罩/关闭按钮/场景切换触发)
      manager.onPopupClose((instance) => {
        if (instance) {
          ctx.player.emit('hotspot:popup-close', {
            id: instance.config.id,
          });
        }
      });

      // 监听场景切换事件 — 加载新场景的热点
      unsubSceneSwitched = ctx.player.on('scene:switched', (data) => {
        const d = data as { sceneId: string; scene?: { config?: { extensions?: Record<string, unknown> } } };
        const ext = d.scene?.config?.extensions;
        if (!ext) {
          manager.setHotspots([]);
          return;
        }

        const hotspotExt = ext.hotspot as HotspotExtension | undefined;
        if (!hotspotExt || !Array.isArray(hotspotExt.hotspots)) {
          manager.setHotspots([]);
          return;
        }

        manager.setHotspots(hotspotExt.hotspots);

        // 预加载跳转目标场景
        if (preloadTargets && ctx.sceneManager) {
          const targets = hotspotExt.hotspots
            .filter((h) => h.type === 'scene' && h.targetScene)
            .map((h) => h.targetScene!) as string[];
          if (targets.length > 0) {
            ctx.sceneManager.preloadScenes(targets).catch(() => {});
          }
        }
      });
    },

    update(frameCtx: FrameContext) {
      if (!manager) return;
      manager.updateVisibility({
        camera: frameCtx.camera,
        vpMatrix: frameCtx.vpMatrix,
        width: frameCtx.size.width,
        height: frameCtx.size.height,
      });
    },

    destroy() {
      unsubSceneSwitched?.();
      manager?.destroy();
    },

    // ── ★ 运行时 API (动态添加/移除热点 + 弹窗控制) ──
    addHotspot(config: HotspotConfig) {
      if (!manager) return;
      const current = manager.list().map((i) => i.config).filter((c) => c.id !== config.id);
      manager.setHotspots([...current, config]);
    },

    removeHotspot(id: string) {
      if (!manager) return;
      manager.setHotspots(manager.list().map((i) => i.config).filter((c) => c.id !== id));
    },

    openPopup(id: string) {
      if (!manager) return false;
      const ok = manager.openPopup(id);
      if (ok) {
        const inst = manager.get(id);
        if (inst?.config.popup) {
          ctx.player.emit('hotspot:popup-open', { id, popup: inst.config.popup });
        }
      }
      return ok;
    },

    closePopup() {
      manager?.closePopup();
    },
  };

  return plugin;
}

export { HotspotManager } from './hotspot-manager.js';
export type { HotspotConfig, HotspotExtension, HotspotType, HotspotStyle, HotspotVisibility, HotspotAction, HotspotHover, HotspotPopup } from './hotspot-config.js';
export type { HotspotInstance } from './hotspot-manager.js';
