/**
 * LoadingIndicator — 加载进度指示器插件
 *
 * 在场景加载时显示加载动画和进度, 加载完成后自动隐藏。
 *
 * 工作流程:
 *   1. 监听 scene:switching → 显示加载指示器
 *   2. 监听 scene:switched → 隐藏加载指示器
 *   3. 监听 load → 隐藏初始加载指示器
 *   4. 监听 error → 显示错误状态
 *
 * [来源: TourPlayer 事件系统 — packages/core/src/tour-player.ts]
 */

import type { TourPlugin, TourPluginContext } from '@3dgs/core';

/** 加载指示器选项 */
export interface LoadingIndicatorOptions {
  /** 自定义加载指示器 HTML (默认 spinner) */
  template?: string;
  /** 加载文本 (默认 '加载中...') */
  text?: string;
  /** 背景色 (默认 'rgba(0,0,0,0.7)') */
  background?: string;
  /** 文字颜色 (默认 '#ffffff') */
  color?: string;
  /** spinner 颜色 (默认 '#ffffff') */
  spinnerColor?: string;
  /** 淡入淡出动画时长 (ms, 默认 300) */
  fadeDuration?: number;
  /** 是否显示进度百分比 (默认 false) */
  showProgress?: boolean;
}

const SPINNER_SVG = `
<div class="3dgs-loading-spinner" style="
  width: 40px; height: 40px;
  border: 3px solid rgba(255,255,255,0.2);
  border-top-color: var(--3dgs-spinner-color, #fff);
  border-radius: 50%;
  animation: 3dgs-spin 0.8s linear infinite;
  margin: 0 auto 12px;
"></div>`;

const SPINNER_KEYFRAMES = `
@keyframes 3dgs-spin { to { transform: rotate(360deg); } }`;

/**
 * 创建加载指示器插件
 *
 * @example
 * ```typescript
 * player.use(createLoadingIndicatorPlugin({
 *   text: '正在加载场景...',
 *   showProgress: true,
 * }));
 * ```
 */
export function createLoadingIndicatorPlugin(
  options: LoadingIndicatorOptions = {},
): TourPlugin {
  const {
    template,
    text = '加载中...',
    background = 'rgba(0,0,0,0.7)',
    color = '#ffffff',
    spinnerColor = '#ffffff',
    fadeDuration = 300,
    showProgress = false,
  } = options;

  let ctx: TourPluginContext;
  let el: HTMLDivElement | null = null;
  let textEl: HTMLSpanElement | null = null;
  let progressEl: HTMLSpanElement | null = null;
  let isVisible = false;

  return {
    name: 'loading-indicator',
    version: '0.1.0',

    init(pluginCtx: TourPluginContext) {
      ctx = pluginCtx;

      // 注入 keyframes
      if (!document.getElementById('3dgs-loading-styles')) {
        const style = document.createElement('style');
        style.id = '3dgs-loading-styles';
        style.textContent = SPINNER_KEYFRAMES;
        document.head.appendChild(style);
      }

      // 创建加载指示器
      el = document.createElement('div');
      el.className = '3dgs-loading-indicator';
      Object.assign(el.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        color,
        fontSize: '14px',
        fontFamily: 'system-ui, sans-serif',
        pointerEvents: 'none',
        zIndex: '9998',
        opacity: '0',
        transition: `opacity ${fadeDuration}ms ease`,
      } as Partial<CSSStyleDeclaration>);

      el.style.setProperty('--3dgs-spinner-color', spinnerColor);

      if (template) {
        el.innerHTML = template;
      } else {
        el.innerHTML = SPINNER_SVG;
        const textContainer = document.createElement('div');
        textContainer.style.textAlign = 'center';

        textEl = document.createElement('span');
        textEl.textContent = text;
        textEl.style.display = 'block';
        textContainer.appendChild(textEl);

        if (showProgress) {
          progressEl = document.createElement('span');
          progressEl.style.display = 'block';
          progressEl.style.opacity = '0.6';
          progressEl.style.fontSize = '12px';
          progressEl.style.marginTop = '4px';
          textContainer.appendChild(progressEl);
        }

        el.appendChild(textContainer);
      }

      ctx.container.appendChild(el);

      // 监听事件
      ctx.player.on('scene:switching', () => show('切换场景...'));
      ctx.player.on('scene:switched', () => hide());
      ctx.player.on('load', () => hide());
      ctx.player.on('error', (data) => {
        const d = data as { message?: string };
        showError(d?.message ?? '加载失败');
      });

      // 监听进度事件 (如果渲染器支持)
      ctx.player.on('load:progress', (data) => {
        const d = data as { progress?: number };
        if (progressEl && d.progress !== undefined) {
          progressEl.textContent = `${Math.round(d.progress * 100)}%`;
        }
      });
    },

    destroy() {
      if (el) {
        el.remove();
        el = null;
      }
      textEl = null;
      progressEl = null;
    },
  };

  // ─── 内部方法 ────────────────────────────────────────────

  function show(label?: string): void {
    if (!el || isVisible) return;
    if (textEl && label) {
      textEl.textContent = label;
    }
    isVisible = true;
    el.style.opacity = '1';
  }

  function hide(): void {
    if (!el || !isVisible) return;
    isVisible = false;
    el.style.opacity = '0';
  }

  function showError(message: string): void {
    if (!el) return;
    if (textEl) {
      textEl.textContent = message;
      textEl.style.color = '#ff6b6b';
    }
    isVisible = true;
    el.style.opacity = '1';
    // 3 秒后自动隐藏
    setTimeout(() => hide(), 3000);
  }
}
