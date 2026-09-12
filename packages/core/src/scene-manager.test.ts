import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RendererAdapter } from './renderer-adapter.js';
import { SceneManager } from './scene-manager.js';
import type { TourDefaults } from './tour-config.js';

const mockDefaults: TourDefaults = {
  transition: { type: 'fade', duration: 800 },
};

function createManager(): SceneManager {
  return new SceneManager(mockDefaults);
}

function registerScenes(mgr: SceneManager) {
  mgr.register('scene1', { source: 's1.splat', defaults: mockDefaults });
  mgr.register('scene2', { source: 's2.splat', defaults: mockDefaults });
}

describe('SceneManager', () => {
  let mgr: SceneManager;

  beforeEach(() => {
    mgr = createManager();
    registerScenes(mgr);
  });

  describe('register', () => {
    it('注册场景后可通过 get 获取', () => {
      const scene = mgr.get('scene1');
      expect(scene).toBeDefined();
      expect(scene!.id).toBe('scene1');
      expect(scene!.config.source).toBe('s1.splat');
    });

    it('拒绝重复注册相同 ID', () => {
      expect(() => mgr.register('scene1', { source: 'dup.splat' })).toThrow(/已注册/);
    });
  });

  describe('loadScene', () => {
    it('加载场景后状态变为 loaded', async () => {
      const scene = await mgr.loadScene('scene1');
      expect(scene.state).toBe('loaded');
    });

    it('拒绝未注册的场景', async () => {
      await expect(mgr.loadScene('unknown')).rejects.toThrow(/未注册/);
    });

    it('重复加载已加载场景直接返回', async () => {
      const s1 = await mgr.loadScene('scene1');
      const s2 = await mgr.loadScene('scene1');
      expect(s1).toBe(s2);
    });
  });

  describe('switchTo', () => {
    it('切换后 getCurrentId 返回新 ID', async () => {
      await mgr.switchTo('scene2');
      expect(mgr.getCurrentId()).toBe('scene2');
      expect(mgr.getCurrent()!.id).toBe('scene2');
    });

    it('切换到未加载场景会先加载', async () => {
      await mgr.switchTo('scene1');
      expect(mgr.get('scene1')!.state).toBe('loaded');
    });
  });

  describe('preload', () => {
    it('预加载场景但不切换当前', async () => {
      await mgr.preload('scene2');
      expect(mgr.get('scene2')!.state).toBe('loaded');
      expect(mgr.getCurrentId()).toBeNull();
    });

    it('preloadScenes 批量预加载', async () => {
      await mgr.preloadScenes(['scene1', 'scene2']);
      expect(mgr.get('scene1')!.state).toBe('loaded');
      expect(mgr.get('scene2')!.state).toBe('loaded');
    });

    // ── ★ TD-03/R-05: 端到端预加载 ─────────────────────────

    it('bindRenderer 后 preload 调用渲染器 preloadScene, 不改变场景状态', async () => {
      const preloadScene = vi.fn().mockResolvedValue(undefined);
      mgr.bindRenderer({ preloadScene } as unknown as RendererAdapter);

      await mgr.preload('scene2');

      expect(preloadScene).toHaveBeenCalledTimes(1);
      // 预取不切换可见场景 → 场景保持 unloaded, 切换时 loadScene 命中缓存
      expect(mgr.get('scene2')!.state).toBe('unloaded');
    });

    it('preloadScene 抛错时静默降级 (切换时仍可正常加载)', async () => {
      const preloadScene = vi.fn().mockRejectedValue(new Error('网络失败'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mgr.bindRenderer({ preloadScene } as unknown as RendererAdapter);

      await mgr.preload('scene2'); // 不应 reject

      expect(preloadScene).toHaveBeenCalledTimes(1);
      expect(mgr.get('scene2')!.state).toBe('unloaded');
      warn.mockRestore();
    });

    it('渲染器无 preloadScene 实现时回退为状态标记 (旧行为)', async () => {
      mgr.bindRenderer({} as unknown as RendererAdapter);

      await mgr.preload('scene2');

      expect(mgr.get('scene2')!.state).toBe('loaded');
    });
  });

  describe('list', () => {
    it('返回所有已注册场景', () => {
      const list = mgr.list();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.id).sort()).toEqual(['scene1', 'scene2']);
    });
  });

  describe('events', () => {
    it('加载场景时发出 progress 和 loaded 事件', async () => {
      const events: string[] = [];
      mgr.on('scene:loaded', (e) => events.push(e.type));
      mgr.on('scene:progress', (e) => events.push(e.type));

      await mgr.loadScene('scene1');

      expect(events).toContain('scene:progress');
      expect(events).toContain('scene:loaded');
    });

    it('切换场景时发出 switched 事件', async () => {
      let switchedId = '';
      mgr.on('scene:switched', (e) => {
        switchedId = e.sceneId;
      });

      await mgr.switchTo('scene2');
      expect(switchedId).toBe('scene2');
    });
  });

  describe('destroy', () => {
    it('销毁后清空所有数据', () => {
      mgr.destroy();
      expect(mgr.list()).toHaveLength(0);
      expect(mgr.getCurrentId()).toBeNull();
    });
  });
});
