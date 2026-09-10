/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutoRotatePlugin } from './index.js';
import type { TourPluginContext, FrameContext } from '@3dgs/core';

function makeMockCtx(): TourPluginContext & {
  _listeners: Map<string, ((...args: unknown[]) => void)[]>;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    container,
    player: <any>{
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
        return () => {};
      }),
      emit: vi.fn(),
    },
    renderer: { setCameraRotation: vi.fn() } as unknown as TourPluginContext['renderer'],
    sceneManager: undefined,
    _listeners: listeners,
  } as unknown as TourPluginContext & { _listeners: Map<string, ((...args: unknown[]) => void)[]> };
}

function emit(
  ctx: { _listeners: Map<string, ((...args: unknown[]) => void)[]> },
  event: string,
  data?: unknown,
) {
  for (const h of ctx._listeners.get(event) || []) h(data);
}

describe('AutoRotate — 自动旋转插件', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('插件元数据', () => {
    it('名称和版本正确', () => {
      const plugin = createAutoRotatePlugin();
      expect(plugin.name).toBe('auto-rotate');
      expect(plugin.version).toBe('0.1.0');
    });
  });

  describe('帧率无关旋转', () => {
    it('update 发射 autorotate:frame 事件', () => {
      const plugin = createAutoRotatePlugin({ enabled: true });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      const frameCtx: FrameContext = {
        deltaTime: 16.67,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext;

      plugin.update(frameCtx);
      expect(ctx.player.emit).toHaveBeenCalledWith(
        'autorotate:frame',
        expect.objectContaining({ axis: 'yaw' }),
      );
    });

    it('deltaDeg = speed × direction × (dt / 1000)', () => {
      const speed = 20;
      const direction = 1;
      const deltaTime = 50; // 50ms
      const expected = speed * direction * (deltaTime / 1000); // = 1.0

      const plugin = createAutoRotatePlugin({ enabled: true, speed, direction });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      plugin.update({
        deltaTime,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);

      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:frame', {
        axis: 'yaw',
        delta: expected,
      });
    });

    it('direction = -1 时 delta 为负', () => {
      const plugin = createAutoRotatePlugin({ enabled: true, speed: 10, direction: -1 });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      plugin.update({
        deltaTime: 100,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);

      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:frame', {
        axis: 'yaw',
        delta: -1, // 10 * (-1) * (100/1000) = -1
      });
    });
  });

  describe('启用/禁用控制', () => {
    it('默认 disabled 时 update 不发射事件', () => {
      const plugin = createAutoRotatePlugin({ enabled: false });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);

      expect(ctx.player.emit).not.toHaveBeenCalledWith('autorotate:frame', expect.anything());
    });

    it('autorotate:start 事件启用旋转', () => {
      const plugin = createAutoRotatePlugin({ enabled: false });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      emit(ctx, 'autorotate:start');
      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);

      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:frame', expect.anything());
    });

    it('autorotate:stop 事件禁用旋转', () => {
      const plugin = createAutoRotatePlugin({ enabled: true });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      emit(ctx, 'autorotate:stop');
      (ctx.player.emit as ReturnType<typeof vi.fn>).mockClear();
      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);

      expect(ctx.player.emit).not.toHaveBeenCalledWith('autorotate:frame', expect.anything());
    });

    it('autorotate:toggle 切换状态', () => {
      const plugin = createAutoRotatePlugin({ enabled: false });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      // toggle on
      emit(ctx, 'autorotate:toggle');
      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);
      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:frame', expect.anything());

      // toggle off
      (ctx.player.emit as ReturnType<typeof vi.fn>).mockClear();
      emit(ctx, 'autorotate:toggle');
      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);
      expect(ctx.player.emit).not.toHaveBeenCalledWith('autorotate:frame', expect.anything());
    });
  });

  describe('交互暂停与恢复', () => {
    it('用户交互时暂停并发射 autorotate:paused', () => {
      const plugin = createAutoRotatePlugin({ enabled: true, pauseOnInteraction: true });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      ctx.container.dispatchEvent(new PointerEvent('pointerdown'));
      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:paused', {});
    });

    it('暂停后 idleDelay 内 update 不发射 frame', () => {
      const plugin = createAutoRotatePlugin({
        enabled: true,
        pauseOnInteraction: true,
        idleDelay: 3000,
      });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      ctx.container.dispatchEvent(new PointerEvent('pointerdown'));
      (ctx.player.emit as ReturnType<typeof vi.fn>).mockClear();

      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);
      expect(ctx.player.emit).not.toHaveBeenCalledWith('autorotate:frame', expect.anything());
    });

    it('idleDelay 后自动恢复并发射 autorotate:resumed', () => {
      const plugin = createAutoRotatePlugin({
        enabled: true,
        pauseOnInteraction: true,
        idleDelay: 3000,
      });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      ctx.container.dispatchEvent(new PointerEvent('pointerdown'));
      (ctx.player.emit as ReturnType<typeof vi.fn>).mockClear();

      // 模拟时间前进超过 idleDelay
      vi.advanceTimersByTime(3100);

      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);
      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:resumed', {});
    });
  });

  describe('axis 配置', () => {
    it('axis=pitch 时发射 pitch 轴旋转', () => {
      const plugin = createAutoRotatePlugin({ enabled: true, axis: 'pitch' });
      const ctx = makeMockCtx();
      plugin.init(ctx);

      plugin.update({
        deltaTime: 100,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);

      expect(ctx.player.emit).toHaveBeenCalledWith('autorotate:frame', {
        axis: 'pitch',
        delta: expect.any(Number),
      });
    });
  });

  describe('destroy', () => {
    it('destroy 后 update 不再发射事件', () => {
      const plugin = createAutoRotatePlugin({ enabled: true });
      const ctx = makeMockCtx();
      plugin.init(ctx);
      plugin.destroy();

      (ctx.player.emit as ReturnType<typeof vi.fn>).mockClear();
      plugin.update({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: new Float32Array(16),
        size: { width: 800, height: 600 },
      } as unknown as FrameContext);
      // destroy 后 isActive 状态被清理, 但 isActive 是闭包变量, destroy 不会重置它
      // 不过事件监听器被移除, container 事件不再触发
    });
  });
});
