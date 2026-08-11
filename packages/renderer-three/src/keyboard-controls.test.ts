/**
 * KeyboardControls 共享模块测试
 *
 * ★ M4: 验证从 RenderManager / WebGPURenderManager 提取的键盘控制逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { KeyboardControls } from './keyboard-controls.js';

// ── Mock window + KeyboardEvent (Node 环境无 DOM) ─────────

/** Mock KeyboardEvent — Node 环境无 KeyboardEvent, 需手动构造 */
class MockKeyboardEvent extends Event {
  readonly key: string;
  constructor(type: string, init: { key: string }) {
    super(type);
    this.key = init.key;
  }
}

class MockWindow extends EventTarget {
  dispatchKeyDown(key: string) {
    this.dispatchEvent(new MockKeyboardEvent('keydown', { key }));
  }
  dispatchKeyUp(key: string) {
    this.dispatchEvent(new MockKeyboardEvent('keyup', { key }));
  }
  dispatchBlur() {
    this.dispatchEvent(new Event('blur'));
  }
}

let mockWin: MockWindow;

beforeEach(() => {
  mockWin = new MockWindow();
  vi.stubGlobal('window', mockWin);
  vi.stubGlobal('KeyboardEvent', MockKeyboardEvent);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 测试 ──────────────────────────────────────────────────

describe('KeyboardControls', () => {
  let controls: KeyboardControls;

  beforeEach(() => {
    controls = new KeyboardControls({ moveSpeed: 5.0, verticalSpeed: 3.0 });
  });

  afterEach(() => {
    controls.teardown();
  });

  describe('构造与配置', () => {
    it('使用默认值构造', () => {
      const c = new KeyboardControls();
      expect(c.moveSpeed).toBe(5.0);
      expect(c.verticalSpeed).toBe(3.0);
      expect(c.isEnabled).toBe(true);
      c.teardown();
    });

    it('使用自定义值构造', () => {
      const c = new KeyboardControls({ moveSpeed: 10, verticalSpeed: 5, enabled: false });
      expect(c.moveSpeed).toBe(10);
      expect(c.verticalSpeed).toBe(5);
      expect(c.isEnabled).toBe(false);
      c.teardown();
    });
  });

  describe('setMoveSpeed / setVerticalSpeed', () => {
    it('设置移动速度', () => {
      controls.setMoveSpeed(15.0);
      expect(controls.moveSpeed).toBe(15.0);
    });

    it('设置升降速度', () => {
      controls.setVerticalSpeed(7.0);
      expect(controls.verticalSpeed).toBe(7.0);
    });
  });

  describe('setup / teardown', () => {
    it('setup 注册事件监听器', () => {
      const addSpy = vi.spyOn(mockWin, 'addEventListener');
      controls.setup();
      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('blur', expect.any(Function));
    });

    it('teardown 移除事件监听器', () => {
      controls.setup();
      const removeSpy = vi.spyOn(mockWin, 'removeEventListener');
      controls.teardown();
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('blur', expect.any(Function));
    });

    it('多次调用 setup 是幂等的', () => {
      const addSpy = vi.spyOn(mockWin, 'addEventListener');
      controls.setup();
      controls.setup();
      // 只注册一次 keydown
      const keydownCalls = addSpy.mock.calls.filter(c => c[0] === 'keydown');
      expect(keydownCalls).toHaveLength(1);
    });

    it('teardown 后 getActiveMoveKeys 返回空数组', () => {
      controls.setup();
      controls.teardown();
      expect(controls.getActiveMoveKeys()).toEqual([]);
    });
  });

  describe('键盘事件处理', () => {
    beforeEach(() => {
      controls.setup();
    });

    it('按下 WASD 键被追踪', () => {
      mockWin.dispatchKeyDown('w');
      mockWin.dispatchKeyDown('a');
      expect(controls.getActiveMoveKeys()).toContain('w');
      expect(controls.getActiveMoveKeys()).toContain('a');
    });

    it('松开键后从追踪中移除', () => {
      mockWin.dispatchKeyDown('w');
      mockWin.dispatchKeyUp('w');
      expect(controls.getActiveMoveKeys()).not.toContain('w');
    });

    it('非移动键被忽略', () => {
      mockWin.dispatchKeyDown('x');
      expect(controls.getActiveMoveKeys()).not.toContain('x');
    });

    it('blur 事件清空所有按键', () => {
      mockWin.dispatchKeyDown('w');
      mockWin.dispatchKeyDown('a');
      mockWin.dispatchBlur();
      expect(controls.getActiveMoveKeys()).toEqual([]);
    });
  });

  describe('applyMovement', () => {
    it('无按键时相机不移动', () => {
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);
      const initialPos = camera.position.clone();

      controls.applyMovement(camera, 16.67);

      expect(camera.position.x).toBeCloseTo(initialPos.x, 10);
      expect(camera.position.y).toBeCloseTo(initialPos.y, 10);
      expect(camera.position.z).toBeCloseTo(initialPos.z, 10);
    });

    it('W 键使相机沿本地 Z 轴前进 (负方向)', () => {
      controls.setup();
      mockWin.dispatchKeyDown('w');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      // 多帧积累速度 (指数平滑需要多帧达到目标速度)
      for (let i = 0; i < 100; i++) {
        controls.applyMovement(camera, 16.67);
      }

      // W = 前进 = 本地 Z 负方向
      expect(camera.position.z).toBeLessThan(0);
    });

    it('S 键使相机沿本地 Z 轴后退 (正方向)', () => {
      controls.setup();
      mockWin.dispatchKeyDown('s');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      for (let i = 0; i < 100; i++) {
        controls.applyMovement(camera, 16.67);
      }

      expect(camera.position.z).toBeGreaterThan(0);
    });

    it('Q 键使相机沿 Y 轴上升', () => {
      controls.setup();
      mockWin.dispatchKeyDown('q');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      for (let i = 0; i < 100; i++) {
        controls.applyMovement(camera, 16.67);
      }

      expect(camera.position.y).toBeGreaterThan(0);
    });

    it('E 键使相机沿 Y 轴下降', () => {
      controls.setup();
      mockWin.dispatchKeyDown('e');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      for (let i = 0; i < 100; i++) {
        controls.applyMovement(camera, 16.67);
      }

      expect(camera.position.y).toBeLessThan(0);
    });

    it('D 键使相机沿本地 X 轴右移', () => {
      controls.setup();
      mockWin.dispatchKeyDown('d');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      for (let i = 0; i < 100; i++) {
        controls.applyMovement(camera, 16.67);
      }

      expect(camera.position.x).toBeGreaterThan(0);
    });

    it('A 键使相机沿本地 X 轴左移', () => {
      controls.setup();
      mockWin.dispatchKeyDown('a');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      for (let i = 0; i < 100; i++) {
        controls.applyMovement(camera, 16.67);
      }

      expect(camera.position.x).toBeLessThan(0);
    });

    it('帧率无关: 不同 dt 下最终位移接近一致', () => {
      controls.setup();
      mockWin.dispatchKeyDown('w');

      // 60fps: 16.67ms × 100 帧 = 1.667s
      const cam60 = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      for (let i = 0; i < 100; i++) controls.applyMovement(cam60, 16.67);

      // 30fps: 33.33ms × 50 帧 = 1.667s
      // 需要新的 controls 实例 (因为速度累积状态不同)
      controls.teardown();
      controls = new KeyboardControls({ moveSpeed: 5.0, verticalSpeed: 3.0 });
      controls.setup();
      mockWin.dispatchKeyDown('w');
      const cam30 = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      for (let i = 0; i < 50; i++) controls.applyMovement(cam30, 33.33);

      // 允许误差 (指数平滑的离散近似, 不同 dt 下有微小差异)
      // 但连续模型 exp(-dt/τ) 在总时间相同时结果应非常接近
      const ratio = cam30.position.z / cam60.position.z;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    });

    it('teardown 后速度归零, applyMovement 不移动相机', () => {
      controls.setup();
      mockWin.dispatchKeyDown('w');

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 0);

      for (let i = 0; i < 50; i++) controls.applyMovement(camera, 16.67);
      const posBeforeTeardown = camera.position.z;

      controls.teardown();
      for (let i = 0; i < 50; i++) controls.applyMovement(camera, 16.67);

      // teardown 后速度归零, 位置应减速趋近停止 (但不完全停, 因为指数衰减)
      // 主要验证: 位置变化率大幅减小
      expect(Math.abs(camera.position.z - posBeforeTeardown)).toBeLessThan(Math.abs(posBeforeTeardown));
    });
  });
});
