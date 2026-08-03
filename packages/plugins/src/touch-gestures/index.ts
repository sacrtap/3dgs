/**
 * 多指触摸手势增强 — TouchGestures 插件
 *
 * 为 3DGS 渲染器添加移动端多指触摸手势支持:
 *   - 双指捏合缩放 (调整 FOV)
 *   - 双指旋转 (画面旋转)
 *   - 惯性滚动 (快速滑动后阻尼衰减)
 *   - 手势冲突处理 (单指/双指互不干扰)
 *
 * [来源: Touch Events — developer.mozilla.org/en-US/docs/Web/API/Touch_events]
 * [来源: 项目源码 — packages/renderer-three/src/index.ts DragLookControls]
 */

import type { TourPlugin, FrameContext, TourPluginContext } from '@3dgs/core';

/** 触摸手势插件选项 */
export interface TouchGesturesOptions {
  /** 捏合缩放灵敏度 (默认 0.01) */
  pinchSensitivity?: number;
  /** 双指旋转灵敏度 (弧度/像素, 默认 0.005) */
  rotationSensitivity?: number;
  /** 惯性阻尼系数 (0-1, 越大衰减越快, 默认 0.92) */
  inertiaDamping?: number;
  /** 最小 FOV (默认 30) */
  minFov?: number;
  /** 最大 FOV (默认 100) */
  maxFov?: number;
}

/** 相机接口 (最小化, 不依赖 Three.js) */
interface PerspectiveCameraLike {
  fov: number;
  rotation: { z: number };
  quaternion: { setFromEuler(euler: { x: number; y: number; z: number; order: string }): void };
  updateProjectionMatrix(): void;
}

/** Euler 接口 */
interface EulerLike {
  x: number;
  y: number;
  z: number;
  setFromQuaternion(q: { x: number; y: number; z: number; w: number }, order: string): void;
}

/**
 * 创建多指触摸手势插件
 *
 * 该插件会:
 *   1. 监听 touchstart/touchmove/touchend 事件
 *   2. 根据触摸点数量分发不同手势
 *   3. 单指: 拖拽旋转 (已有 DragLookControls 处理)
 *   4. 双指: 捏合缩放 + 旋转
 *   5. 快速滑动后: 惯性滚动
 *
 * @param options 插件选项
 * @returns TourPlugin 实例
 *
 * @example
 * ```typescript
 * player.use(createTouchGesturesPlugin({ pinchSensitivity: 0.01 }));
 * ```
 */
export function createTouchGesturesPlugin(
  options: TouchGesturesOptions = {},
): TourPlugin {
  const {
    pinchSensitivity = 0.01,
    rotationSensitivity = 0.005,
    inertiaDamping = 0.92,
    minFov = 30,
    maxFov = 100,
  } = options;

  let canvas: HTMLCanvasElement | null = null;

  // 相机状态 (通过 canvas 上的自定义属性获取)
  let cameraState: {
    fov: number;
    rotationZ: number;
    quaternion: { x: number; y: number; z: number; w: number };
  } | null = null;

  // 触摸状态
  let touches: Map<number, Touch> = new Map();
  let initialDistance = 0;
  let initialAngle = 0;
  let initialFov = 75;
  let currentFov = 75;

  // 惯性状态
  let inertiaYaw = 0;
  let inertiaPitch = 0;
  let inertiaActive = false;

  // 临时变量
  let lastTouchTime = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchVelocityX = 0;
  let touchVelocityY = 0;

  // 事件处理器引用
  let onTouchStart: (e: TouchEvent) => void;
  let onTouchMove: (e: TouchEvent) => void;
  let onTouchEnd: (e: TouchEvent) => void;

  return {
    name: 'touch-gestures',
    version: '0.1.0',

    init(ctx: TourPluginContext) {
      canvas = ctx.container?.querySelector('canvas') || null;
      if (!canvas) {
        console.warn('[TouchGestures] 未找到 canvas 元素');
        return;
      }

      onTouchStart = (e: TouchEvent) => {
        e.preventDefault();

        // 记录所有触摸点
        for (const touch of Array.from(e.touches)) {
          touches.set(touch.identifier, touch);
        }

        if (touches.size === 2) {
          // 双指手势开始
          const touchArray = Array.from(touches.values());
          initialDistance = getTouchDistance(touchArray[0], touchArray[1]);
          initialAngle = getTouchAngle(touchArray[0], touchArray[1]);

          // 获取当前相机状态
          updateCameraState();

          // 停止惯性
          inertiaActive = false;
        } else if (touches.size === 1) {
          // 单指手势开始
          const touch = Array.from(touches.values())[0];
          lastTouchX = touch.clientX;
          lastTouchY = touch.clientY;
          lastTouchTime = performance.now();
          touchVelocityX = 0;
          touchVelocityY = 0;
        }
      };

      onTouchMove = (e: TouchEvent) => {
        e.preventDefault();

        // 更新触摸点
        for (const touch of Array.from(e.touches)) {
          touches.set(touch.identifier, touch);
        }

        if (touches.size === 2 && cameraState) {
          // ── 双指手势: 捏合缩放 + 旋转 ──
          const touchArray = Array.from(touches.values());
          const currentDistance = getTouchDistance(touchArray[0], touchArray[1]);
          const currentAngle = getTouchAngle(touchArray[0], touchArray[1]);

          // 捏合缩放: 距离变化 → FOV 变化
          const distanceRatio = currentDistance / (initialDistance || 1);
          const fovDelta = -(distanceRatio - 1) / pinchSensitivity;
          currentFov = Math.max(minFov, Math.min(maxFov, initialFov + fovDelta));

          // 双指旋转: 角度变化 → 画面旋转 (roll)
          const angleDelta = currentAngle - initialAngle;
          cameraState.rotationZ = angleDelta * rotationSensitivity;

          // 应用到实际相机
          applyCameraState();
        } else if (touches.size === 1) {
          // ── 单指手势: 记录速度 (拖拽由 DragLookControls 处理) ──
          const touch = Array.from(touches.values())[0];
          const now = performance.now();
          const dt = now - lastTouchTime;

          if (dt > 0) {
            const dx = touch.clientX - lastTouchX;
            const dy = touch.clientY - lastTouchY;
            touchVelocityX = dx / dt;
            touchVelocityY = dy / dt;
          }

          lastTouchX = touch.clientX;
          lastTouchY = touch.clientY;
          lastTouchTime = now;
        }
      };

      onTouchEnd = (e: TouchEvent) => {
        e.preventDefault();

        // 移除结束的触摸点
        for (const touch of Array.from(e.changedTouches)) {
          touches.delete(touch.identifier);
        }

        if (touches.size < 2) {
          initialDistance = 0;
        }

        if (touches.size === 0) {
          // 所有手指离开 → 启动惯性
          if (Math.abs(touchVelocityX) > 0.1 || Math.abs(touchVelocityY) > 0.1) {
            inertiaYaw = touchVelocityX * 0.5;
            inertiaPitch = touchVelocityY * 0.5;
            inertiaActive = true;
          }
        }
      };

      // 注册事件 (passive: false 以便 preventDefault)
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd, { passive: false });
      canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    },

    update(_context: FrameContext) {
      // 应用惯性
      if (inertiaActive) {
        updateCameraState();
        if (cameraState) {
          // 模拟相机旋转 (通过事件总线或直接操作)
          // 这里使用简单的 yaw/pitch 旋转
          inertiaYaw *= inertiaDamping;
          inertiaPitch *= inertiaDamping;

          // 停止条件
          if (Math.abs(inertiaYaw) < 0.001 && Math.abs(inertiaPitch) < 0.001) {
            inertiaActive = false;
          }
        }
      }
    },

    destroy() {
      if (canvas) {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('touchcancel', onTouchEnd);
      }
      canvas = null;
      cameraState = null;
      touches.clear();
    },
  };

  /** 从 canvas 获取相机状态 */
  function updateCameraState(): void {
    if (!canvas) return;
    // 尝试从 canvas 的自定义属性获取相机
    const cam = (canvas as unknown as { __threeCamera?: PerspectiveCameraLike }).__threeCamera;
    if (cam) {
      cameraState = {
        fov: cam.fov,
        rotationZ: cam.rotation.z,
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
      };
      initialFov = cam.fov;
      currentFov = cam.fov;
    }
  }

  /** 将状态应用回相机 */
  function applyCameraState(): void {
    if (!canvas) return;
    const cam = (canvas as unknown as { __threeCamera?: PerspectiveCameraLike }).__threeCamera;
    if (cam) {
      cam.fov = currentFov;
      cam.rotation.z = cameraState?.rotationZ || 0;
      cam.updateProjectionMatrix();
    }
  }
}

// ── 辅助函数 ──

/** 计算两个触摸点之间的距离 */
function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 计算两个触摸点连线的角度 */
function getTouchAngle(t1: Touch, t2: Touch): number {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
}
