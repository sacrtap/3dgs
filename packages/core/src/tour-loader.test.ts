import { describe, it, expect, beforeEach } from 'vitest';
import { TourLoader } from './tour-loader.js';
import type { TourConfig } from './tour-config.js';

const validConfig: TourConfig = {
  version: '1.0',
  scenes: {
    scene1: { source: 's1.splat' },
    scene2: { source: 's2.splat' },
  },
};

describe('TourLoader', () => {
  let loader: TourLoader;

  beforeEach(() => {
    loader = new TourLoader();
  });

  describe('fromObject', () => {
    it('从对象创建 runtime', () => {
      const runtime = loader.fromObject(validConfig);

      expect(runtime.sceneManager).toBeDefined();
      expect(runtime.sceneManager.list()).toHaveLength(2);
      expect(runtime.currentScene).toBeNull();
    });

    it('拒绝无效配置', () => {
      expect(() => loader.fromObject({ version: '2.0' })).toThrow();
    });

    it('带 source 时缓存配置', () => {
      loader.fromObject(validConfig, 'test-key');
      // 第二次从缓存加载
      const runtime = loader.fromObject(validConfig, 'test-key');
      expect(runtime.sceneManager.list()).toHaveLength(2);
    });
  });

  describe('clearCache', () => {
    it('清除缓存后不影响新加载', () => {
      loader.fromObject(validConfig, 'key1');
      loader.clearCache();
      const runtime = loader.fromObject(validConfig, 'key1');
      expect(runtime.sceneManager.list()).toHaveLength(2);
    });
  });

  describe('abort', () => {
    it('调用 abort 不抛异常', () => {
      expect(() => loader.abort()).not.toThrow();
    });
  });
});
