import { describe, it, expect, vi } from 'vitest';
import { PluginSystem } from './plugin-system.js';
import type { TourPlugin } from './plugin-system.js';
import type { TourPlayer } from './tour-player.js';

function createMockPlayer(): TourPlayer {
  // 在 node 环境下 document 可能不存在, 使用简单对象模拟
  const fakeContainer = (globalThis.document?.createElement('div') ?? {}) as HTMLElement;
  return {
    getSceneManager: () => undefined,
    getRenderer: () => undefined,
    getContainer: () => fakeContainer,
  } as unknown as TourPlayer;
}

describe('PluginSystem', () => {
  it('注册插件后可在 list 中找到', () => {
    const sys = new PluginSystem();
    const player = createMockPlayer();
    const plugin: TourPlugin = { name: 'test', version: '1.0' };

    sys.register(plugin, player);

    expect(sys.list()).toHaveLength(1);
    expect(sys.list()[0].name).toBe('test');
  });

  it('拒绝重复注册同名插件', () => {
    const sys = new PluginSystem();
    const player = createMockPlayer();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin: TourPlugin = { name: 'dup', version: '1.0' };

    sys.register(plugin, player);
    sys.register(plugin, player);

    expect(sys.list()).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('已注册'));
    warnSpy.mockRestore();
  });

  it('init 回调在注册时执行', () => {
    const sys = new PluginSystem();
    const player = createMockPlayer();
    const initFn = vi.fn();
    const plugin: TourPlugin = { name: 'init-test', version: '1.0', init: initFn };

    sys.register(plugin, player);

    expect(initFn).toHaveBeenCalledTimes(1);
    expect(initFn).toHaveBeenCalledWith(expect.objectContaining({ player }));
  });

  it('update 回调在每帧执行并接收 deltaTime', () => {
    const sys = new PluginSystem();
    const player = createMockPlayer();
    const updateFn = vi.fn();
    const plugin: TourPlugin = { name: 'update-test', version: '1.0', update: updateFn };

    sys.register(plugin, player);
    sys.update(16, {
      camera: { x: 0, y: 0, z: 0 },
      vpMatrix: new Float32Array(16),
      size: { width: 800, height: 600 },
    });

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        deltaTime: 16,
        camera: { x: 0, y: 0, z: 0 },
      }),
    );
  });

  it('destroyAll 调用每个插件的 destroy', () => {
    const sys = new PluginSystem();
    const player = createMockPlayer();
    const destroyFn = vi.fn();
    const plugin: TourPlugin = { name: 'destroy-test', version: '1.0', destroy: destroyFn };

    sys.register(plugin, player);
    sys.destroyAll();

    expect(destroyFn).toHaveBeenCalledTimes(1);
    expect(sys.list()).toHaveLength(0);
  });

  it('destroyAll 中插件 destroy 抛异常不影响其他插件', () => {
    const sys = new PluginSystem();
    const player = createMockPlayer();
    const destroyFn2 = vi.fn();
    const p1: TourPlugin = {
      name: 'p1',
      version: '1.0',
      destroy: () => {
        throw new Error('boom');
      },
    };
    const p2: TourPlugin = { name: 'p2', version: '1.0', destroy: destroyFn2 };

    sys.register(p1, player);
    sys.register(p2, player);
    sys.destroyAll();

    expect(destroyFn2).toHaveBeenCalledTimes(1);
  });
});
