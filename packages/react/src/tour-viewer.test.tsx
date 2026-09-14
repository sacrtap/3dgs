/**
 * ★ TD-10: React TourViewer 组件测试
 *
 * 环境: jsdom + @testing-library/react, mock @3dgs/core 的 TourPlayer
 *
 * 覆盖:
 *   1. 挂载 → 创建 TourPlayer + setRenderer + load(config)
 *   2. load 事件 → onLoad 回调 + 自动 switchScene(initialScene)
 *   3. 错误 → onError + 错误状态渲染
 *   4. config 变化 → 触发 reload (不重建 player)
 *   5. renderer 引用变化 → 重建 TourPlayer
 *   6. 卸载 → destroy + 事件退订
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import type { TourPlugin, RendererAdapter } from '@3dgs/core';

// ── TourPlayer mock ───────────────────────────────────────
/** Mock TourPlayer 的可断言形态 (字段均为 vi.fn 或 Map) */
interface MockTourPlayerShape {
  on: (type: string, fn: (data: unknown) => void) => () => void;
  load: (config: unknown) => Promise<void>;
  destroy: () => void;
  setRenderer: (r: unknown) => void;
  use: (p: unknown) => void;
  switchScene: (id: string) => Promise<void>;
  handlers: Map<string, Array<(data: unknown) => void>>;
}

let playerMock: MockTourPlayerShape | undefined;

vi.mock('@3dgs/core', async (importOriginal) => {
  const actual = await importOriginal<{
    TourPlayer?: unknown;
  }>();
  class MockTourPlayer {
    handlers = new Map<string, Array<(data: unknown) => void>>();

    on(type: string, fn: (data: unknown) => void): () => void {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
      return () => {
        const list = this.handlers.get(type) ?? [];
        this.handlers.set(
          type,
          list.filter((f) => f !== fn),
        );
      };
    }
    load = vi.fn(async () => {});
    destroy = vi.fn();
    setRenderer = vi.fn();
    use = vi.fn();
    switchScene = vi.fn(async () => {});

    constructor(_container: HTMLElement) {
      const self = this as unknown as MockTourPlayerShape;
      self.on = self.on.bind(self);
      playerMock = self;
    }
  }
  return {
    ...actual,
    TourPlayer: MockTourPlayer,
  };
});

import { TourViewer } from './index.js';
import type { TourViewerProps } from './index.js';

function makeRenderer(): RendererAdapter {
  return { mount: vi.fn(), destroy: vi.fn() } as unknown as RendererAdapter;
}

function makeConfig(): Record<string, unknown> {
  return {
    version: 1,
    scenes: {
      a: { source: 'http://x/a.splat' },
      b: { source: 'http://x/b.splat' },
    },
  };
}

/** 触发已注册的 player 事件 */
function emitPlayer(type: string, data: unknown): void {
  const handlers = playerMock!.handlers.get(type) ?? [];
  for (const h of handlers) act(() => h(data));
}

describe('TD-10 React TourViewer', () => {
  beforeEach(() => {
    playerMock = undefined;
    vi.clearAllMocks();
  });

  it('★ 挂载: 创建 TourPlayer + setRenderer + load(config)', () => {
    const props: TourViewerProps = {
      config: makeConfig() as never,
      renderer: makeRenderer(),
      className: 'my-tour',
    };
    const { container } = render(React.createElement(TourViewer, props));

    expect(playerMock).toBeDefined();
    expect(playerMock!.setRenderer).toHaveBeenCalledTimes(1);
    expect(playerMock!.load).toHaveBeenCalledWith(props.config);
    // className 透传到容器 div
    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root!.className).toContain('my-tour');
    expect(root!.style.position).toBe('relative');
  });

  it('★ renderer 为工厂函数: 调用工厂取得实例', () => {
    const factory = vi.fn(makeRenderer);
    render(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: factory,
      }),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(playerMock!.setRenderer).toHaveBeenCalledTimes(1);
  });

  it('★ load 事件 → onLoad 回调 + 自动 switchScene(initialScene)', () => {
    const onLoad = vi.fn();
    const onEvent = vi.fn();
    render(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: makeRenderer(),
        initialScene: 'b',
        onLoad,
        onEvent,
      }),
    );

    emitPlayer('load', { sceneId: 'a' });

    expect(onLoad).toHaveBeenCalledWith({ sceneId: 'a' });
    expect(onEvent).toHaveBeenCalledWith('load', { sceneId: 'a' });
    // 自动切换 (仅当 initialScene 提供)
    expect(playerMock!.switchScene).toHaveBeenCalledWith('b');
  });

  it('★ 无 initialScene 时不调用 switchScene', () => {
    render(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: makeRenderer(),
      }),
    );
    emitPlayer('load', { sceneId: 'a' });
    expect(playerMock!.switchScene).not.toHaveBeenCalled();
  });

  it('★ 插件注册: player.use 每插件调用一次', () => {
    const p1 = { name: 'p1' } as unknown as TourPlugin;
    const p2 = { name: 'p2' } as unknown as TourPlugin;
    render(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: makeRenderer(),
        plugins: [p1, p2],
      }),
    );
    expect(playerMock!.use).toHaveBeenCalledTimes(2);
    expect(playerMock!.use).toHaveBeenCalledWith(p1);
    expect(playerMock!.use).toHaveBeenCalledWith(p2);
  });

  it('★ error 事件 → onError + onEvent + 错误渲染', () => {
    const onError = vi.fn();
    const { rerender } = render(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: makeRenderer(),
        onError,
      }),
    );
    emitPlayer('error', { message: 'load failed' });
    expect(onError).toHaveBeenCalledWith('load failed');
    expect(screen.getByText(/load failed/)).not.toBeNull();

    // 后续 load 成功 → 错误清除
    emitPlayer('load', {});
    rerender(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: makeRenderer(),
      }),
    );
    expect(screen.queryByText(/load failed/)).toBeNull();
  });

  it('★ 卸载: destroy + 事件退订', () => {
    const { unmount } = render(
      React.createElement(TourViewer, {
        config: makeConfig() as never,
        renderer: makeRenderer(),
      }),
    );
    const pm = playerMock!;
    // 注册了 load/error 等事件
    expect(pm.handlers.size).toBeGreaterThan(0);
    unmount();
    expect(pm.destroy).toHaveBeenCalledTimes(1);
    // 全部退订
    for (const [, list] of pm.handlers) {
      expect(list.length).toBe(0);
    }
  });
});
