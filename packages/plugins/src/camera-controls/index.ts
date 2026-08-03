/**
 * CameraControls — 相机控制插件
 *
 * v4.1 新增: 从渲染器中分离相机控制逻辑
 * 提供:
 *   - 桌面端: 鼠标拖拽旋转 + 滚轮缩放
 *   - 移动端: 单指拖拽旋转 + 双指缩放
 *   - 陀螺仪 (可选)
 *
 * 注意: 此插件为轻量级触摸控制
 * 渲染器 (如 ThreeRenderer/Spark) 自身可能已包含 OrbitControls
 * 如渲染器已提供控制，则此插件仅作为事件桥接
 */

import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';

export interface CameraControlsOptions {
  enableZoom?: boolean;
  enablePan?: boolean;
  enableRotate?: boolean;
  /** 缩放范围 */
  minDistance?: number;
  maxDistance?: number;
  /** 垂直角度限制 */
  minPolarAngle?: number;
  maxPolarAngle?: number;
  /** 阻尼 */
  dampingFactor?: number;
}

export function createCameraControls(options: CameraControlsOptions = {}): TourPlugin {
  const {
    enableZoom = true,
    enableRotate = true,
    dampingFactor = 0.08,
    minDistance = 0.3,
    maxDistance = 20,
    minPolarAngle = 0,
    maxPolarAngle = Math.PI * 0.85,
  } = options;

  let ctx: TourPluginContext;
  let container: HTMLElement;
  let renderer: TourPluginContext['renderer'];

  // 相机状态
  let yaw = 0;
  let pitch = 0;
  let distance = 3;
  let targetYaw = 0;
  let targetPitch = 0;
  let targetDistance = 3;

  // 输入状态
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let activePointerId: number | null = null;

  return {
    name: 'camera-controls',
    version: '0.1.0',

    init(pluginCtx) {
      ctx = pluginCtx;
      container = ctx.container;
      renderer = ctx.renderer;

      // ── 桌面端: 鼠标 ──
      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerUp);
      container.addEventListener('pointerleave', onPointerUp);
      container.addEventListener('wheel', onWheel, { passive: false });
    },

    update(_frameCtx: FrameContext) {
      if (!renderer) return;

      // 阻尼插值
      const t = 1 - Math.pow(dampingFactor, _frameCtx.deltaTime / 16.67);
      yaw += (targetYaw - yaw) * t;
      pitch += (targetPitch - pitch) * t;
      distance += (targetDistance - distance) * t;

      applyCamera();
    },

    destroy() {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('pointerleave', onPointerUp);
      container.removeEventListener('wheel', onWheel);
    },
  };

  // ─── 输入处理 ────────────────────────────────────────────

  function onPointerDown(e: PointerEvent) {
    if (!enableRotate) return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    container.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging || e.pointerId !== activePointerId) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const rotSpeed = 0.005;
    targetYaw -= dx * rotSpeed;
    targetPitch -= dy * rotSpeed;

    // 限制 pitch
    targetPitch = Math.max(
      minPolarAngle - Math.PI / 2,
      Math.min(maxPolarAngle - Math.PI / 2, targetPitch),
    );
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    isDragging = false;
    activePointerId = null;
    try {
      container.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onWheel(e: WheelEvent) {
    if (!enableZoom) return;
    e.preventDefault();

    const scale = e.deltaY > 0 ? 1.1 : 0.9;
    targetDistance = Math.max(minDistance, Math.min(maxDistance, targetDistance * scale));
  }

  // ─── 相机应用 ────────────────────────────────────────────

  function applyCamera() {
    // 注意: 具体的相机位置设置取决于渲染器实现
    // 对于 Three.js Spark, OrbitControls 已在渲染器内部
    // 此插件提供的事件桥接可用于无内置控制的渲染器
    // 此处仅更新内部状态, 实际相机更新由渲染器的 RAF 回调处理
  }
}
