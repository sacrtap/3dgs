/**
 * Fullscreen — 全屏插件
 *
 * 提供全屏切换功能, 支持:
 *   - 双击全屏切换
 *   - ESC 退出全屏 (浏览器原生)
 *   - 全屏状态变化事件
 *
 * [来源: Fullscreen API — developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API]
 */

import type { TourPlugin, TourPluginContext } from '@3dgs/core';

/** 全屏插件选项 */
export interface FullscreenOptions {
  /** 启用双击切换全屏 (默认 true) */
  enableDoubleClick?: boolean;
  /** 全屏目标元素 (默认 container) */
  target?: HTMLElement;
}

/**
 * 创建全屏插件
 *
 * @example
 * ```typescript
 * player.use(createFullscreenPlugin({ enableDoubleClick: true }));
 *
 * // 手动切换全屏
 * player.emit('fullscreen:toggle');
 *
 * // 监听全屏状态变化
 * player.on('fullscreen:change', (data) => {
 *   console.log('全屏状态:', data.isFullscreen);
 * });
 * ```
 */
export function createFullscreenPlugin(
  options: FullscreenOptions = {},
): TourPlugin {
  const { enableDoubleClick = true, target } = options;

  let ctx: TourPluginContext;
  let fullscreenEl: HTMLElement;
  let doubleClickHandler: (() => void) | null = null;
  let fullscreenChangeHandler: (() => void) | null = null;

  return {
    name: 'fullscreen',
    version: '0.1.0',

    init(pluginCtx: TourPluginContext) {
      ctx = pluginCtx;
      fullscreenEl = target ?? ctx.container;

      // 双击切换全屏
      if (enableDoubleClick) {
        doubleClickHandler = () => toggleFullscreen();
        fullscreenEl.addEventListener('dblclick', doubleClickHandler);
      }

      // 监听全屏状态变化
      fullscreenChangeHandler = () => {
        const isFullscreen = document.fullscreenElement === fullscreenEl;
        ctx.player.emit('fullscreen:change', { isFullscreen });
      };
      document.addEventListener('fullscreenchange', fullscreenChangeHandler);

      // 监听手动切换事件
      ctx.player.on('fullscreen:toggle', () => toggleFullscreen());
      ctx.player.on('fullscreen:enter', () => enterFullscreen());
      ctx.player.on('fullscreen:exit', () => exitFullscreen());
    },

    destroy() {
      if (doubleClickHandler) {
        fullscreenEl?.removeEventListener('dblclick', doubleClickHandler);
        doubleClickHandler = null;
      }
      if (fullscreenChangeHandler) {
        document.removeEventListener('fullscreenchange', fullscreenChangeHandler);
        fullscreenChangeHandler = null;
      }
      // 退出全屏
      if (document.fullscreenElement === fullscreenEl) {
        document.exitFullscreen().catch(() => {});
      }
    },
  };

  // ─── 内部方法 ────────────────────────────────────────────

  function toggleFullscreen(): void {
    if (document.fullscreenElement === fullscreenEl) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }

  function enterFullscreen(): void {
    if (document.fullscreenElement) return;
    fullscreenEl.requestFullscreen?.().catch((err) => {
      console.warn('[Fullscreen] 进入全屏失败:', err);
    });
  }

  function exitFullscreen(): void {
    if (document.fullscreenElement !== fullscreenEl) return;
    document.exitFullscreen().catch(() => {});
  }
}
