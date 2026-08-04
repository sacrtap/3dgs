import { describe, it, expect, beforeEach } from 'vitest';
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
