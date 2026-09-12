/**
 * ★ TD-27: DragLookControls DOM 交互测试
 *
 * 环境: jsdom (真实 DOM 事件派发)
 *
 * 覆盖:
 *   1. 拖拽旋转: pointerdown → pointermove → 相机朝向 (yaw/pitch) 更新
 *   2. pitch 限制: 拖拽过度不越过 ±(π/2 - 0.05)
 *   3. 阻尼开启时 update() 渐进接近目标, 关闭时立即对齐
 *   4. 滚轮: 沿视线方向位移
 *   5. lookAt: 重定向相机 + 重置阻尼目标
 *   6. dispose: 移除全部事件监听
 *   7. target 兼容属性 = position + forward
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { DragLookControls } from './drag-look-controls.js';

function makeControls() {
  const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000);
  const dom = document.createElement('div');
  // jsdom 缺 Pointer Capture API; 运行时不检查该成员存在性 (DragLookControls 内 try/catch 兜底),
  // 故在此以已知目标形状注入桩 — 与 DOM 规范签名一致, 非外部不可信数据
  const domWithCapture = dom as unknown as {
    setPointerCapture: (id: number) => void;
    releasePointerCapture: (id: number) => void;
  };
  domWithCapture.setPointerCapture = () => {};
  domWithCapture.releasePointerCapture = () => {};
  const controls = new DragLookControls(camera, dom);
  return { controls, camera, dom };
}

/** 派发指针事件 */
function firePointer(dom: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  dom.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 派发滚轮事件 */
function fireWheel(dom: HTMLElement, deltaY: number): void {
  dom.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
}

describe('TD-27 DragLookControls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ 拖拽旋转 100px → yaw 变化 = dx × rotateSpeed', () => {
    const { controls, dom } = makeControls();
    const startYaw = controls['_euler'].y;

    firePointer(dom, 'pointerdown', 100, 100);
    firePointer(dom, 'pointermove', 200, 100); // dx = +100
    firePointer(dom, 'pointerup', 200, 100);

    // 拖拽后 update() 应用目标 euler (无阻尼? enableDamping 默认 true → 渐进)
    controls.enableDamping = false;
    controls.update();
    const expectedYaw = startYaw + 100 * 0.003; // rotateSpeed 0.003
    expect(controls['_euler'].y).toBeCloseTo(expectedYaw, 6);
  });

  it('★ 无阻尼时 update 立即对齐目标; 拖拽后立即生效', () => {
    const { controls, dom } = makeControls();
    controls.enableDamping = false;

    firePointer(dom, 'pointerdown', 0, 0);
    firePointer(dom, 'pointermove', 50, 0); // dx=50 → yaw +0.15
    firePointer(dom, 'pointerup', 50, 0);

    controls.update();
    expect(controls['_euler'].y).toBeCloseTo(0.15, 5);
  });

  it('★ pitch 限制: 拖拽超过 ±(π/2 - 0.05) 被钳制', () => {
    const { controls, dom } = makeControls();
    controls.enableDamping = false;

    // 初始 pitch ≈ 0; 向下拖 50000px = 150 rad >> 上限
    firePointer(dom, 'pointerdown', 0, 0, 7);
    firePointer(dom, 'pointermove', 0, 50000, 7);
    firePointer(dom, 'pointerup', 0, 50000, 7);
    controls.update();

    expect(Math.abs(controls['_euler'].x)).toBeLessThanOrEqual(Math.PI / 2 - 0.04);
  });

  it('★ 滚轮 deltaY < 0 → 相机沿视线前进 (z 减小)', () => {
    const { controls, camera, dom } = makeControls();
    const before = camera.position.clone();

    fireWheel(dom, -120); // 前滚
    // wheel 处理使用当前 _euler (无阻尼下与目标一致)
    controls.enableDamping = false;
    controls.update();

    // 初始朝向 (0,0,-1), forward → 位置沿 -z
    expect(camera.position.z).toBeLessThan(before.z - 0.1);
  });

  it('★ lookAt 重定向相机并重置阻尼目标', () => {
    const { controls, camera } = makeControls();
    controls.lookAt(0, 0, -10);
    // 相机应看向 (0,0,-1) 方向; 位置不变 (lookAt 不改位置)
    expect(camera.position.length()).toBe(0);
    // 阻尼目标已重置为当前朝向 → 立即 update 不再漂移
    controls.update();
    const q1 = camera.quaternion.clone();
    controls.update();
    expect(camera.quaternion.equals(q1)).toBe(true);
  });

  it('★ target 兼容属性 = position + forward', () => {
    const { controls, camera } = makeControls();
    camera.position.set(1, 2, 3);
    controls.enableDamping = false;
    controls.update();

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
    expect(controls.target.x).toBeCloseTo(fwd.x, 5);
    expect(controls.target.y).toBeCloseTo(fwd.y, 5);
    expect(controls.target.z).toBeCloseTo(fwd.z, 5);
  });

  it('★ dispose 移除全部事件监听 (派发后无效果)', () => {
    const { controls, dom } = makeControls();
    controls.dispose();

    // dispose 后拖拽不应改变朝向
    const yawBefore = controls['_euler'].y;
    firePointer(dom, 'pointerdown', 0, 0, 3);
    firePointer(dom, 'pointermove', 100, 0, 3);
    firePointer(dom, 'pointerup', 100, 0, 3);
    controls.enableDamping = false;
    controls.update();
    expect(controls['_euler'].y).toBe(yawBefore);
  });

  it('★ 拖拽捕获异常安全 (setPointerCapture 抛错不崩溃)', () => {
    const { controls, dom } = makeControls();
    // 覆盖实例桩为抛错版本
    const domWithCapture = dom as unknown as { setPointerCapture: (id: number) => void };
    domWithCapture.setPointerCapture = () => {
      throw new Error('not implemented');
    };
    expect(() => {
      firePointer(dom, 'pointerdown', 0, 0, 9);
      firePointer(dom, 'pointermove', 10, 0, 9);
      firePointer(dom, 'pointerup', 10, 0, 9);
    }).not.toThrow();
  });

  it('★ 阻尼开启: 多次 update 渐进接近目标并经阻尼平滑', () => {
    const { controls, dom } = makeControls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.5;

    firePointer(dom, 'pointerdown', 0, 0, 4);
    firePointer(dom, 'pointermove', 100, 0, 4); // target yaw +0.3
    firePointer(dom, 'pointerup', 100, 0, 4);

    controlLoop(controls, 3); // 手动调用 update 3 次 (RAF 循环由宿主驱动)
    // 每次接近 50%, 3 次后 >= 87.5% 但未完全到位
    const targetYaw = 0.3;
    expect(controls['_euler'].y).toBeGreaterThan(targetYaw * 0.87);
    expect(controls['_euler'].y).toBeLessThan(targetYaw * 0.99);

    controlLoop(controls, 20);
    expect(controls['_euler'].y).toBeCloseTo(targetYaw, 4);
  });
});

/** 连续调用 update n 次 (模拟多帧) */
function controlLoop(controls: DragLookControls, n: number): void {
  for (let i = 0; i < n; i++) controls.update();
}
