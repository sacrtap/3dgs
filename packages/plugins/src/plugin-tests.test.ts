/**
 * ★ TD-35/36: 插件测试
 *
 * 环境: jsdom (真实 DOM 事件)
 *
 * loading-indicator (TD-35):
 *   1. init: 创建指示器元素 + keyframes + 挂载到 container
 *   2. scene:switching → 显示 (opacity 1); scene:switched → 隐藏
 *   3. load → 隐藏
 *   4. error → 显示错误文本 + 红色
 *   5. load:progress → 进度百分比文本
 *   6. destroy: 移除元素
 *
 * fullscreen (TD-36):
 *   7. dblclick → 进入全屏 (requestFullscreen)
 *   8. 已全屏 dblclick → 退出 (exitFullscreen)
 *   9. player 'fullscreen:toggle'/'fullscreen:enter'/'fullscreen:exit' 事件驱动
 *   10. 'fullscreen:change' 事件在 fullscreenchange 时派发
 *   11. destroy: 注销监听 + 退出全屏
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TourPluginContext, RendererAdapter } from '@3dgs/core';
import { createLoadingIndicatorPlugin } from './loading-indicator/index.js';
import { createFullscreenPlugin } from './fullscreen/index.js';

/** Mock TourPlayer (事件注册/触发) */
class MockPlayer {
  handlers = new Map<string, Array<(data?: unknown) => void>>();
  on(type: string, fn: (data?: unknown) => void): () => void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    return () => {
      const list = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        list.filter((f) => f !== fn),
      );
    };
  }
  emit(type: string, data?: unknown): void {
    for (const fn of this.handlers.get(type) ?? []) fn(data);
  }
}

function makeContext(): {
  ctx: TourPluginContext;
  container: HTMLElement;
  player: MockPlayer;
} {
  const container = document.createElement('div');
  const player = new MockPlayer();
  const renderer = { mount: vi.fn(), destroy: vi.fn() } as unknown as RendererAdapter;
  const ctx = { player, container, renderer } as unknown as TourPluginContext;
  return { ctx, container, player };
}

describe('TD-35 loading-indicator 插件', () => {
  it('★ init: 创建元素 + keyframes + 挂载到 container', () => {
    const { ctx, container } = makeContext();
    const plugin = createLoadingIndicatorPlugin({ text: '加载中' });
    plugin.init!(ctx);

    expect(container.querySelector('[class="3dgs-loading-indicator"]')).not.toBeNull();
    expect(document.getElementById('3dgs-loading-styles')).not.toBeNull();
    expect(container.querySelector('span')?.textContent).toBe('加载中');
  });

  it('★ scene:switching → 显示; scene:switched → 隐藏', () => {
    const { ctx, container, player } = makeContext();
    const plugin = createLoadingIndicatorPlugin();
    plugin.init!(ctx);
    const el = container.querySelector('[class="3dgs-loading-indicator"]') as HTMLElement;

    expect(el.style.opacity).toBe('0'); // 初始隐藏
    player.emit('scene:switching');
    expect(el.style.opacity).toBe('1');
    player.emit('scene:switched');
    expect(el.style.opacity).toBe('0');
  });

  it('★ load → 隐藏', () => {
    const { ctx, container, player } = makeContext();
    const plugin = createLoadingIndicatorPlugin();
    plugin.init!(ctx);
    const el = container.querySelector('[class="3dgs-loading-indicator"]') as HTMLElement;

    player.emit('scene:switching');
    expect(el.style.opacity).toBe('1');
    player.emit('load');
    expect(el.style.opacity).toBe('0');
  });

  it('★ error → 显示错误文本 + 红色', () => {
    const { ctx, container, player } = makeContext();
    const plugin = createLoadingIndicatorPlugin();
    plugin.init!(ctx);
    const el = container.querySelector('[class="3dgs-loading-indicator"]') as HTMLElement;
    const spans = container.querySelectorAll('span');

    player.emit('error', { message: '加载失败: 404' });
    expect(el.style.opacity).toBe('1');
    expect(spans[0].textContent).toBe('加载失败: 404');
    // jsdom 将 #ff6b6b 序列化为 rgb()
    expect(spans[0].style.color).toBe('rgb(255, 107, 107)');
  });

  it('★ load:progress → 进度百分比文本', () => {
    const { ctx, container, player } = makeContext();
    const plugin = createLoadingIndicatorPlugin({ showProgress: true });
    plugin.init!(ctx);
    const spans = container.querySelectorAll('span');

    player.emit('load:progress', { progress: 0.42 });
    expect(Array.from(spans).map((s) => s.textContent)).toContain('42%');
  });

  it('★ destroy: 移除元素', () => {
    const { ctx, container } = makeContext();
    const plugin = createLoadingIndicatorPlugin();
    plugin.init!(ctx);
    expect(container.querySelector('[class="3dgs-loading-indicator"]')).not.toBeNull();
    plugin.destroy!();
    expect(container.querySelector('[class="3dgs-loading-indicator"]')).toBeNull();
  });
});

describe('TD-36 fullscreen 插件', () => {
  let fsElement: Element | null;
  const calls: Array<{ kind: string; el?: Element }> = [];

  beforeEach(() => {
    calls.length = 0;
    fsElement = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fsElement,
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: function requestFullscreen(this: Element) {
        calls.push({ kind: 'request', el: this });
        fsElement = this;
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: () => {
        calls.push({ kind: 'exit' });
        fsElement = null;
        return Promise.resolve();
      },
    });
  });

  it('★ dblclick → requestFullscreen', async () => {
    const { ctx, container } = makeContext();
    const plugin = createFullscreenPlugin();
    plugin.init!(ctx);

    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(calls.some((c) => c.kind === 'request')).toBe(true));
    expect(calls.find((c) => c.kind === 'request')?.el).toBe(container);
  });

  it('★ 已全屏 dblclick → exitFullscreen', async () => {
    const { ctx, container } = makeContext();
    const plugin = createFullscreenPlugin();
    plugin.init!(ctx);
    fsElement = container; // 模拟已在全屏

    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(calls.some((c) => c.kind === 'exit')).toBe(true));
  });

  it('★ player 事件: fullscreen:toggle / enter / exit', async () => {
    const { ctx, player } = makeContext();
    const plugin = createFullscreenPlugin();
    plugin.init!(ctx);

    player.emit('fullscreen:enter');
    await vi.waitFor(() => expect(calls.some((c) => c.kind === 'request')).toBe(true));

    player.emit('fullscreen:exit');
    await vi.waitFor(() => expect(calls.some((c) => c.kind === 'exit')).toBe(true));

    // toggle: 当前未全屏 → 进入
    player.emit('fullscreen:toggle');
    await vi.waitFor(() => expect(calls.filter((c) => c.kind === 'request').length).toBe(2));

    // toggle: 已全屏 → 退出
    player.emit('fullscreen:toggle');
    await vi.waitFor(() => expect(calls.filter((c) => c.kind === 'exit').length).toBe(2));
  });

  it("★ fullscreenchange → player 派发 'fullscreen:change'", () => {
    const { ctx, container, player } = makeContext();
    const plugin = createFullscreenPlugin();
    plugin.init!(ctx);
    const emitted: unknown[] = [];
    player.on('fullscreen:change', (data) => emitted.push(data));

    // 进入全屏 → 派发 isFullscreen: true
    fsElement = container;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(emitted).toEqual([{ isFullscreen: true }]);

    // 退出 → false
    fsElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(emitted[1]).toEqual({ isFullscreen: false });
  });

  it('★ enableDoubleClick=false: dblclick 不触发全屏', () => {
    const { ctx, container } = makeContext();
    const plugin = createFullscreenPlugin({ enableDoubleClick: false });
    plugin.init!(ctx);

    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(calls.some((c) => c.kind === 'request')).toBe(false);
  });

  it('★ destroy: 注销 dblclick 监听 + 已全屏时退出', () => {
    const { ctx, container } = makeContext();
    const plugin = createFullscreenPlugin();
    plugin.init!(ctx);
    fsElement = container;

    plugin.destroy!();
    // destroy 退出全屏
    expect(calls.some((c) => c.kind === 'exit')).toBe(true);

    // destroy 后 DOM 级 dblclick 不再触发
    calls.length = 0;
    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(calls).toEqual([]);
  });
});
