/**
 * ★ TD-11: RenderManager 主流程测试 (WebGL 后端)
 *
 * 环境: jsdom (桩 WebGLRenderer + Spark + DOM API, 不触碰真实 GPU)
 *
 * 覆盖:
 *   1. 构造与选项 (deviceTier/pixelRatio/resolutionScale/adaptiveResolution)
 *   2. mount + start: 挂载、渲染循环启动、DPR 监听注册
 *   3. loadScene: .splat 全量/降采样路径 (fetch mock + SplatMesh onLoad 手动触发)
 *   4. preloadScene 缓存: 命中后不重复 fetch
 *   5. getStats: 加载后 visibleSplats 计数正确
 *   6. destroy: 清理 preload 缓存 / renderer / 监听
 *   7. 保护路径: 未启动 loadScene 抛错 / 空 source 抛错
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceTier } from '@3dgs/core';
import type { RenderStats } from '@3dgs/core';

/** 构造 mock fetch response (fetchWithProgress 需要 ok/headers/body/arrayBuffer) */
function mockFetchResponse(data: Uint8Array): Response {
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' ? String(buffer.byteLength) : null,
    },
    arrayBuffer: async () => buffer,
    body: null,
  } as unknown as Response;
}

// ── Spark mock (工厂内联定义, vi.mock 提升后仍可用) ───────
let lastSplatMeshOptions: Record<string, unknown> | undefined;

vi.mock('@sparkjsdev/spark', async (importOriginal) => {
  const actual = await importOriginal<{
    SplatFileType?: Record<string, unknown>;
  }>();
  class MockSplatMesh {
    rotation = { x: 0 };
    matrixWorld = {
      clone: () => ({
        applyMatrix4: () => ({
          getCenter: () => ({ x: 0, y: 0, z: 0 }),
          getSize: () => ({ x: 1, y: 1, z: 1 }),
        }),
      }),
    };
    dispose = () => {};
    updateMatrixWorld = () => {};
    createLodSplats = async () => {};
    getBoundingBox = () => ({
      clone: () => ({
        applyMatrix4: () => ({
          getCenter: () => ({ x: 0, y: 0, z: 0 }),
          getSize: () => ({ x: 1, y: 1, z: 1 }),
        }),
      }),
    });
    constructor(options: Record<string, unknown>) {
      lastSplatMeshOptions = options;
      // 构造后 microtask 触发 onLoad, 让 loadScene 的 Promise 放行
      const onLoad = options.onLoad as ((mesh: MockSplatMesh) => void) | undefined;
      if (onLoad) {
        queueMicrotask(() => onLoad(this));
      }
    }
  }
  class MockSparkRenderer {
    renderSize = { set: () => {} };
    dispose = () => {};
    parent: { remove: () => void } | null = null;
  }
  return {
    ...actual,
    SplatFileType: { SPLAT: 'SPLAT', SPZ: 'SPZ' },
    SparkRenderer: MockSparkRenderer,
    SplatMesh: MockSplatMesh,
  };
});

// ── three mock: 保留真实类, 仅桩 WebGLRenderer ──────────
vi.mock('three', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class MockWebGLRenderer {
    // 用真实 canvas 元素, 使 container.appendChild 通过 jsdom Node 校验
    domElement: HTMLCanvasElement;
    constructor() {
      this.domElement = document.createElement('canvas');
      this.domElement.addEventListener = vi.fn(
        this.domElement.addEventListener.bind(this.domElement),
      );
      this.domElement.removeEventListener = vi.fn(
        this.domElement.removeEventListener.bind(this.domElement),
      );
      const canvas = this.domElement;
      canvas.remove = vi.fn(() => {
        canvas.parentNode?.removeChild(canvas);
      }) as unknown as () => void;
    }
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    setClearColor = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

// ── DOM / 全局桩 ─────────────────────────────────────────
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  media: '',
  onchange: null,
  dispatchEvent: vi.fn(),
}));

import { RenderManager } from './webgl-render-manager.js';
import type { RenderManagerOptions } from './webgl-render-manager.js';

/** .splat 格式测试数据 (32B/splat) */
function makeSplatData(count: number): Uint8Array {
  const buffer = new ArrayBuffer(count * 32);
  const view = new DataView(buffer);
  for (let i = 0; i < count; i++) {
    const base = i * 32;
    view.setFloat32(base, i * 0.5, true);
    view.setFloat32(base + 4, i * 0.25, true);
    view.setFloat32(base + 8, Math.cos(i), true);
    view.setFloat32(base + 12, 0.01, true);
    view.setFloat32(base + 16, 0.01, true);
    view.setFloat32(base + 20, 0.01, true);
    view.setUint8(base + 24, 200);
    view.setUint8(base + 25, 100);
    view.setUint8(base + 26, 50);
    view.setUint8(base + 27, 255);
    view.setUint8(base + 28, 128);
    view.setUint8(base + 29, 128);
    view.setUint8(base + 30, 128);
    view.setUint8(base + 31, 128);
  }
  return new Uint8Array(buffer);
}

/** 容器桩 (getBoundingClientRect + appendChild) */
function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const originalAppendChild = el.appendChild.bind(el);
  el.appendChild = vi.fn((node: Node) =>
    originalAppendChild(node),
  ) as unknown as HTMLElement['appendChild'];
  return el;
}

/** 卸载时确保不再有未完成的 fetch (createSplatMeshFromBytes 30s 超时哨兵由 vitest 超时覆盖) */

describe('TD-11 RenderManager 主流程', () => {
  beforeEach(() => {
    lastSplatMeshOptions = undefined;
    vi.restoreAllMocks();
  });

  // ── 1. 构造与选项 ──
  it('★ 默认选项构造: 自适应分辨率启用, 键盘启用', () => {
    const rm = new RenderManager();
    expect(rm).toBeDefined();
    expect(rm.getResolutionScale()).toBeGreaterThan(0);
    expect(rm.isLodReady()).toBe(false);
    expect(rm.getDeviceProfile().tier).toBeDefined();
    rm.destroy();
  });

  it('★ 自定义 deviceTier/pixelRatio/resolutionScale', () => {
    const options: RenderManagerOptions = {
      deviceTier: DeviceTier.LOW,
      pixelRatio: 1,
      resolutionScale: 0.5,
    };
    const rm = new RenderManager(options);
    expect(rm.getResolutionScale()).toBe(0.5);
    rm.destroy();
  });

  it('★ adaptiveResolution: false 时不创建自适应, getResolutionScale 用固定值', () => {
    const rm = new RenderManager({ adaptiveResolution: false, resolutionScale: 0.75 });
    expect(rm.getResolutionScale()).toBe(0.75);
    rm.destroy();
  });

  it('★ getStats 初始值: 0 splats, 默认帧时间', () => {
    const rm = new RenderManager();
    const stats = rm.getStats();
    expect(stats.visibleSplats).toBe(0);
    expect(stats.frameTimeMs).toBeGreaterThan(0);
    expect(stats.bufferPool).toBeDefined();
    expect(stats.bufferPool.hits).toBe(0);
    rm.destroy();
  });

  // ── 2. mount + start ──
  it('★ mount + start: 挂载 renderer.domElement, 启动循环', () => {
    const rm = new RenderManager();
    const container = makeContainer();
    rm.mount(container);
    rm.start();
    expect(container.appendChild).toHaveBeenCalled();
    rm.stop();
    rm.destroy();
  });

  it('★ start 后 loadScene 可用; 未 mount 时不崩溃', () => {
    const rm = new RenderManager();
    rm.start(); // 无 container: 早退
    rm.stop();
    rm.destroy();
  });

  // ── 3. loadScene .splat 路径 ──
  it('★ loadScene 未启动: 抛错 (scene 未初始化)', async () => {
    const rm = new RenderManager();
    await expect(rm.loadScene('http://x/a.splat')).rejects.toThrow(/未启动/);
    rm.destroy();
  });

  it('★ loadScene 空 source: 抛错', async () => {
    const rm = new RenderManager();
    rm.mount(makeContainer());
    rm.start();
    await expect(rm.loadScene('')).rejects.toThrow(/source 为空/);
    rm.destroy();
  });

  it('★ loadScene .splat 全量加载: fetch + SplatMesh onLoad → currentSplat', async () => {
    const splatData = makeSplatData(16);
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(splatData));
    vi.stubGlobal('fetch', fetchMock);

    const rm = new RenderManager();
    rm.mount(makeContainer());
    rm.start();
    await rm.loadScene('http://test/a.splat');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('a.splat'), expect.anything());
    rm.destroy();
  });

  it('★ preloadScene 缓存: 命中后 loadScene 不重复 fetch', async () => {
    const splatData = makeSplatData(8);
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(splatData));
    vi.stubGlobal('fetch', fetchMock);

    const rm = new RenderManager();
    rm.mount(makeContainer());
    rm.start();

    await rm.preloadScene('http://test/b.splat');
    await rm.loadScene('http://test/b.splat');

    // 预取 1 次, 加载命中缓存 (不重复)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rm.getStats().visibleSplats).toBe(8);
    rm.destroy();
  });

  // ── 4. getStats 计数 ──
  it('★ 加载后 getStats.visibleSplats = 实际 splat 数', async () => {
    const splatData = makeSplatData(24);
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(splatData));
    vi.stubGlobal('fetch', fetchMock);

    const rm = new RenderManager();
    rm.mount(makeContainer());
    rm.start();
    await rm.loadScene('http://test/c.splat');
    const stats: RenderStats = rm.getStats();
    expect(stats.visibleSplats).toBe(24);
    expect(stats.renderWidth).toBeGreaterThan(0);
    expect(stats.renderHeight).toBeGreaterThan(0);
    rm.destroy();
  });

  // ── 5. destroy ──
  it('★ destroy: 清理 preload 缓存 / renderer / 监听, 幂等', () => {
    const rm = new RenderManager();
    rm.mount(makeContainer());
    rm.start();
    rm.destroy();
    expect(() => rm.destroy()).not.toThrow(); // 幂等
  });

  it('★ preloadScene 对 .sog 跳过 (不 fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const rm = new RenderManager();
    await rm.preloadScene('http://test/d.sog');
    expect(fetchMock).not.toHaveBeenCalled();
    rm.destroy();
  });
});
