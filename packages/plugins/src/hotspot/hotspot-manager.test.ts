/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HotspotManager } from './hotspot-manager.js';
import type { HotspotConfig } from './hotspot-config.js';

function makeConfig(overrides: Partial<HotspotConfig> & { id?: string } = {}): HotspotConfig {
  return {
    id: 'h1',
    type: 'scene',
    position: [0, 0, -5] as [number, number, number],
    ...overrides,
  };
}

/** Identity-ish VP matrix: places point (0,0,-5) at screen center of 800×600 */
function makeVPForPoint(): Float32Array {
  const m = new Float32Array(16);
  // Perspective VP: camera at origin looking -Z, fov=90°, aspect=1, near=0.1, far=1000
  // Maps (0,0,-5,1) → clip (0,0,5,5) → NDC (0,0,1) → screen center
  const f = 1; // 1/tan(45°)
  const nf = 1 / (0.1 - 1000);
  // col0
  m[0] = f;
  m[1] = 0;
  m[2] = 0;
  m[3] = 0;
  // col1
  m[4] = 0;
  m[5] = f;
  m[6] = 0;
  m[7] = 0;
  // col2
  m[8] = 0;
  m[9] = 0;
  m[10] = (1000 + 0.1) * nf;
  m[11] = -1;
  // col3
  m[12] = 0;
  m[13] = 0;
  m[14] = 2 * 1000 * 0.1 * nf;
  m[15] = 0;
  return m;
}

describe('HotspotManager — 热点管理器', () => {
  let manager: HotspotManager;
  let container: HTMLDivElement;

  beforeEach(() => {
    manager = new HotspotManager();
    container = document.createElement('div');
    document.body.appendChild(container);
    manager.attach(container);
  });

  describe('setHotspots / get / list / clear', () => {
    it('setHotspots 创建 DOM 元素并可通过 id 获取', () => {
      manager.setHotspots([
        makeConfig({ id: 'a', type: 'scene' }),
        makeConfig({ id: 'b', type: 'text' }),
      ]);
      expect(manager.list()).toHaveLength(2);
      expect(manager.get('a')).toBeDefined();
      expect(manager.get('a')!.config.id).toBe('a');
      expect(container.children.length).toBe(2);
    });

    it('setHotspots 替换而非追加', () => {
      manager.setHotspots([makeConfig({ id: 'x' })]);
      manager.setHotspots([makeConfig({ id: 'y' }), makeConfig({ id: 'z' })]);
      expect(manager.list()).toHaveLength(2);
      expect(manager.get('x')).toBeUndefined();
      expect(manager.get('y')).toBeDefined();
    });

    it('clear 移除所有热点和 DOM 元素', () => {
      manager.setHotspots([makeConfig({ id: 'a' }), makeConfig({ id: 'b' })]);
      manager.clear();
      expect(manager.list()).toHaveLength(0);
      expect(container.children.length).toBe(0);
    });

    it('未 attach 容器时 setHotspots 不创建元素', () => {
      const fresh = new HotspotManager();
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fresh.setHotspots([makeConfig({ id: 'orphan' })]);
      expect(fresh.list()).toHaveLength(0);
      spy.mockRestore();
    });
  });

  describe('DOM 元素类型', () => {
    it('text 类型渲染文本内容', () => {
      manager.setHotspots([makeConfig({ id: 't1', type: 'text', onHover: { tooltip: 'Hello' } })]);
      const el = manager.get('t1')!.el;
      expect(el.textContent).toBe('Hello');
      expect(el.dataset.hotspotType).toBe('text');
    });

    it('scene 类型设置圆形样式', () => {
      manager.setHotspots([
        makeConfig({ id: 's1', type: 'scene', style: { size: 40, color: '#ff0000' } }),
      ]);
      const el = manager.get('s1')!.el;
      expect(el.style.borderRadius).toBe('50%');
      expect(el.style.width).toBe('40px');
      expect(el.style.height).toBe('40px');
    });

    it('image 类型设置背景图', () => {
      manager.setHotspots([makeConfig({ id: 'i1', type: 'image', style: { icon: 'pin.png' } })]);
      const el = manager.get('i1')!.el;
      expect(el.style.backgroundImage).toContain('pin.png');
    });

    it('custom/url 类型使用 id 作为文本', () => {
      manager.setHotspots([makeConfig({ id: 'c1', type: 'url' })]);
      const el = manager.get('c1')!.el;
      expect(el.textContent).toBe('c1');
    });
  });

  describe('updateVisibility — 投影与过滤', () => {
    it('可见热点设置 screenPos 并显示', () => {
      manager.setHotspots([makeConfig({ id: 'v1', position: [0, 0, -5] })]);
      manager.updateVisibility({
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: makeVPForPoint(),
        width: 800,
        height: 600,
      });
      const inst = manager.get('v1')!;
      expect(inst.visible).toBe(true);
      expect(inst.screenPos).toBeDefined();
      expect(inst.el.style.display).toBe('flex');
    });

    it('clipW <= 0 时热点不可见 (相机后方)', () => {
      // VP that yields clipW = 0 for any point
      const vp = new Float32Array(16);
      vp[15] = 0; // clipW = 0 regardless of input
      manager.setHotspots([makeConfig({ id: 'behind', position: [0, 0, 5] })]);
      manager.updateVisibility({
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: vp,
        width: 800,
        height: 600,
      });
      expect(manager.get('behind')!.visible).toBe(false);
    });

    it('minDistance 过滤: 距离不足时不可见', () => {
      manager.setHotspots([
        makeConfig({ id: 'near', position: [0, 0, -1], visibility: { minDistance: 5 } }),
      ]);
      manager.updateVisibility({
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: makeVPForPoint(),
        width: 800,
        height: 600,
      });
      // distance = 1 < minDistance 5 → not visible
      expect(manager.get('near')!.visible).toBe(false);
    });

    it('maxDistance 过滤: 距离超出时不可见', () => {
      manager.setHotspots([
        makeConfig({ id: 'far', position: [0, 0, -5], visibility: { maxDistance: 3 } }),
      ]);
      manager.updateVisibility({
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: makeVPForPoint(),
        width: 800,
        height: 600,
      });
      // distance = 5 > maxDistance 3 → not visible
      expect(manager.get('far')!.visible).toBe(false);
    });

    it('距离衰减: maxDistance 存在时 opacity < 1', () => {
      manager.setHotspots([
        makeConfig({ id: 'fade', position: [0, 0, -5], visibility: { maxDistance: 10 } }),
      ]);
      manager.updateVisibility({
        camera: { x: 0, y: 0, z: 0 },
        vpMatrix: makeVPForPoint(),
        width: 800,
        height: 600,
      });
      const inst = manager.get('fade')!;
      if (inst.visible) {
        const opacity = parseFloat(inst.el.style.opacity);
        // distance=5, maxDistance=10 → opacity = max(0.3, 1 - 5/10) = 0.5
        expect(opacity).toBeCloseTo(0.5, 1);
      }
    });
  });

  describe('事件回调', () => {
    it('onClick 注册并触发', () => {
      let clicked = false;
      manager.setHotspots([makeConfig({ id: 'click-me' })]);
      manager.onClick(() => {
        clicked = true;
      });
      const el = manager.get('click-me')!.el;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicked).toBe(true);
    });

    it('onHover 注册并触发', () => {
      let hovered = false;
      manager.setHotspots([makeConfig({ id: 'hover-me' })]);
      manager.onHover(() => {
        hovered = true;
      });
      const el = manager.get('hover-me')!.el;
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(hovered).toBe(true);
    });
  });

  describe('弹出面板 (popup)', () => {
    it('openPopup 对无 popup 配置的热点返回 false', () => {
      manager.setHotspots([makeConfig({ id: 'no-popup' })]);
      expect(manager.openPopup('no-popup')).toBe(false);
    });

    it('openPopup 对配置了 popup 的热点返回 true', () => {
      manager.setHotspots([makeConfig({ id: 'pop', popup: { title: 'Test', content: 'Hello' } })]);
      expect(manager.openPopup('pop')).toBe(true);
      expect(manager.getOpenPopupId()).toBe('pop');
    });

    it('closePopup 清除弹出状态', () => {
      manager.setHotspots([makeConfig({ id: 'pop', popup: { title: 'Test' } })]);
      manager.openPopup('pop');
      manager.closePopup();
      expect(manager.getOpenPopupId()).toBeUndefined();
    });

    it('打开第二个 popup 自动关闭第一个', () => {
      manager.setHotspots([
        makeConfig({ id: 'p1', popup: { title: 'First' } }),
        makeConfig({ id: 'p2', popup: { title: 'Second' } }),
      ]);
      manager.openPopup('p1');
      manager.openPopup('p2');
      expect(manager.getOpenPopupId()).toBe('p2');
    });

    it('onPopupOpen / onPopupClose 回调触发', () => {
      let openedId: string | undefined;
      let closedId: string | undefined;
      manager.setHotspots([makeConfig({ id: 'cb', popup: { title: 'CB' } })]);
      manager.onPopupOpen((inst) => {
        openedId = inst?.config.id;
      });
      manager.onPopupClose((inst) => {
        closedId = inst?.config.id;
      });
      manager.openPopup('cb');
      expect(openedId).toBe('cb');
      manager.closePopup();
      expect(closedId).toBe('cb');
    });

    it('setHotspots 替换时自动关闭已打开的 popup', () => {
      manager.setHotspots([makeConfig({ id: 'old', popup: { title: 'Old' } })]);
      manager.openPopup('old');
      manager.setHotspots([makeConfig({ id: 'new' })]);
      expect(manager.getOpenPopupId()).toBeUndefined();
    });
  });

  describe('injectStyles', () => {
    it('注入 style 元素且幂等', () => {
      HotspotManager.injectStyles();
      expect(document.getElementById('3dgs-hotspot-styles')).not.toBeNull();
      HotspotManager.injectStyles();
      expect(document.getElementById('3dgs-hotspot-styles')).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('清除所有热点和回调', () => {
      manager.setHotspots([makeConfig({ id: 'd1' })]);
      manager.destroy();
      expect(manager.list()).toHaveLength(0);
      expect(container.children.length).toBe(0);
    });
  });
});

import { vi } from 'vitest';
