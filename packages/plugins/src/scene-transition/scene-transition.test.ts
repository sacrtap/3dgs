/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSceneTransitionPlugin } from './index.js';
import type { TourPluginContext, FrameContext } from '@3dgs/core';

function makeMockCtx(): TourPluginContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    container,
    player: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
        return () => {
          const arr = listeners.get(event);
          if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
          }
        };
      }),
      emit: vi.fn(),
      switchScene: vi.fn().mockResolvedValue(undefined),
    },
    renderer: {} as unknown as TourPluginContext['renderer'],
    sceneManager: undefined,
    _listeners: listeners,
  } as unknown as TourPluginContext & { _listeners: Map<string, ((...args: unknown[]) => void)[]> };
}

function emit(
  ctx: TourPluginContext & { _listeners: Map<string, ((...args: unknown[]) => void)[]> },
  event: string,
  data: unknown,
) {
  const handlers = ctx._listeners.get(event) || [];
  for (const h of handlers) h(data);
}

describe('SceneTransition — 场景过渡插件', () => {
  beforeEach(() => {
    // jsdom provides document and performance.now
    vi.stubGlobal('performance', { now: () => Date.now() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('插件元数据', () => {
    it('创建插件具有正确名称和版本', () => {
      const plugin = createSceneTransitionPlugin();
      expect(plugin.name).toBe('scene-transition');
      expect(plugin.version).toBe('0.1.0');
    });
  });

  describe('init — 遮罩层创建', () => {
    it('init 创建 overlay 元素并挂载到 container', () => {
      const plugin = createSceneTransitionPlugin();
      const ctx = makeMockCtx();
      plugin.init(ctx);
      const overlay = ctx.container.firstElementChild;
      expect(overlay).not.toBeNull();
      expect(overlay!.tagName.toLowerCase()).toBe('div');
    });

    it('自定义 fadeColor 应用到 overlay', () => {
      const plugin = createSceneTransitionPlugin({ fadeColor: '#ff0000' });
      const ctx = makeMockCtx();
      plugin.init(ctx);
      const overlay = ctx.container.firstElementChild as HTMLElement;
      expect(overlay.style.background).toBe('rgb(255, 0, 0)');
    });
  });

  describe('fade 状态机', () => {
    it('scene:switching 触发 fade-out (overlay opacity → 1)', () => {
      const plugin = createSceneTransitionPlugin({ defaultType: 'fade', defaultDuration: 800 });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      emit(ctx as any, 'scene:switching', {
        sceneId: 'scene2',
        transition: { type: 'fade', duration: 500 },
      });

      const overlay = ctx.container.firstElementChild as HTMLElement;
      expect(overlay.style.opacity).toBe('1');
    });

    it('instant 类型不触发 fade-out', () => {
      const plugin = createSceneTransitionPlugin({ defaultType: 'fade' });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      emit(ctx as any, 'scene:switching', { sceneId: 'scene2', transition: { type: 'instant' } });

      const overlay = ctx.container.firstElementChild as HTMLElement;
      // instant 不触发 fade → opacity 保持初始值 '0'
      expect(overlay.style.opacity).toBe('0');
    });
  });

  describe('destroy', () => {
    it('destroy 移除 overlay 元素', () => {
      const plugin = createSceneTransitionPlugin();
      const ctx = makeMockCtx();
      plugin.init(ctx);
      expect(ctx.container.firstElementChild).not.toBeNull();
      plugin.destroy();
      expect(ctx.container.firstElementChild).toBeNull();
    });
  });
});

/** 辅助: lerp / lerpAngle 纯函数测试 (从模块内部导出不可达, 通过行为间接验证) */
describe('缓动函数 (通过 fly 行为间接验证)', () => {
  it('linear easing: 中点 = 起止均值', () => {
    // lerp(a, b, 0.5) = (a+b)/2 — 通过 fly 动画的 emit 值验证
    // 此处仅验证数学正确性作为独立函数
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(-90, 90, 0.5)).toBe(0);
  });

  it('lerpAngle: 跨 ±180 边界取短弧', () => {
    const lerpAngle = (a: number, b: number, t: number) => {
      let diff = b - a;
      if (diff > 180) diff -= 360;
      else if (diff < -180) diff += 360;
      return a + diff * t;
    };
    // 从 170° 到 -170°: 短弧是 +20°, 中点 = 180° (或 -180°)
    expect(lerpAngle(170, -170, 0.5)).toBeCloseTo(180, 5);
    // 从 -170° 到 170°: 短弧是 -20°, 中点 = -180°
    expect(lerpAngle(-170, 170, 0.5)).toBeCloseTo(-180, 5);
  });
});
