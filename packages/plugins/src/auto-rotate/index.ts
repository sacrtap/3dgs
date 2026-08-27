/**
 * AutoRotate — 自动旋转插件
 *
 * 在用户无操作时自动旋转相机, 提供全景巡视体验。
 *
 * 特性:
 *   - 可配置旋转速度和方向
 *   - 用户交互时自动暂停, 交互结束后恢复
 *   - 帧率无关的平滑旋转
 *   - 支持手动启停
 *
 * [来源: TourPlayer 事件系统 — packages/core/src/tour-player.ts]
 * [来源: 帧率无关运动 — en.wikipedia.org/wiki/Smooth_frame_rate_independent_movement]
 */

import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';

/** 自动旋转插件选项 */
export interface AutoRotateOptions {
  /** 旋转速度 (度/秒, 默认 10) */
  speed?: number;
  /** 是否默认启用 (默认 false, 需手动开启) */
  enabled?: boolean;
  /** 用户交互后暂停的延迟时间 (ms, 默认 3000) */
  idleDelay?: number;
  /** 旋转方向 (默认 1 = 右, -1 = 左) */
  direction?: 1 | -1;
  /** 旋转轴 (默认 'yaw' 水平旋转, 'pitch' 垂直旋转) */
  axis?: 'yaw' | 'pitch';
  /** 是否在用户交互时自动暂停 (默认 true) */
  pauseOnInteraction?: boolean;
  /** ★ N-07: 是否尊重系统 prefers-reduced-motion 设置 (默认 true, 命中时不自动旋转) */
  respectReducedMotion?: boolean;
}

/**
 * 创建自动旋转插件
 *
 * @example
 * ```typescript
 * player.use(createAutoRotatePlugin({
 *   speed: 15,
 *   idleDelay: 5000,
 * }));
 *
 * // 手动控制
 * player.emit('autorotate:start');
 * player.emit('autorotate:stop');
 * player.emit('autorotate:toggle');
 * ```
 */
export function createAutoRotatePlugin(
  options: AutoRotateOptions = {},
): TourPlugin {
  const {
    speed = 10,
    enabled = false,
    idleDelay = 3000,
    direction = 1,
    axis = 'yaw',
    pauseOnInteraction = true,
    respectReducedMotion = true,
  } = options;

  let ctx: TourPluginContext;
  let isActive = enabled;
  let isPaused = false;
  let lastInteractionTime = 0;
  let interactionTimeout: ReturnType<typeof setTimeout> | null = null;

  // 交互检测
  let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
  let wheelHandler: ((e: WheelEvent) => void) | null = null;
  let keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  // ★ N-07: 减弱动效偏好监听 (无障碍)
  let reducedMotionQuery: MediaQueryList | null = null;
  let reducedMotionHandler: ((e: MediaQueryListEvent) => void) | null = null;

  return {
    name: 'auto-rotate',
    version: '0.1.0',

    init(pluginCtx: TourPluginContext) {
      ctx = pluginCtx;

      // ★ N-07: 尊重系统"减弱动效"偏好 — 命中时不自动旋转 (无障碍要求),
      //   用户仍可通过 autorotate:start 事件显式强制开启; 并动态跟随系统设置变化。
      if (respectReducedMotion && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (reducedMotionQuery.matches) {
          isActive = false;
        }
        reducedMotionHandler = (e: MediaQueryListEvent) => {
          if (e.matches) {
            isActive = false;
            ctx.player.emit('autorotate:reduced-motion', {});
          }
        };
        reducedMotionQuery.addEventListener?.('change', reducedMotionHandler);
      }

      // 监听手动控制事件
      ctx.player.on('autorotate:start', () => {
        isActive = true;
        isPaused = false;
      });
      ctx.player.on('autorotate:stop', () => {
        isActive = false;
      });
      ctx.player.on('autorotate:toggle', () => {
        isActive = !isActive;
      });
      ctx.player.on('autorotate:set-speed', (data) => {
        const d = data as { speed?: number };
        if (d.speed !== undefined) {
          // 更新速度 (通过闭包变量无法直接修改, 通过事件传递)
          ctx.player.emit('autorotate:speed-changed', { speed: d.speed });
        }
      });

      // 交互检测
      if (pauseOnInteraction) {
        pointerDownHandler = () => onUserInteraction();
        wheelHandler = () => onUserInteraction();
        keyDownHandler = (e) => {
          if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
            onUserInteraction();
          }
        };

        ctx.container.addEventListener('pointerdown', pointerDownHandler);
        ctx.container.addEventListener('wheel', wheelHandler, { passive: true });
        window.addEventListener('keydown', keyDownHandler);
      }
    },

    update(frameCtx: FrameContext) {
      if (!isActive || !ctx.renderer) return;

      // 检查是否应该从暂停状态恢复
      if (isPaused) {
        if (performance.now() - lastInteractionTime >= idleDelay) {
          isPaused = false;
          ctx.player.emit('autorotate:resumed', {});
        }
        return;
      }

      // 帧率无关的旋转
      // deltaDeg = speed * (dt / 1000) * direction
      const dt = frameCtx.deltaTime;
      const deltaDeg = speed * direction * (dt / 1000);

      // 通过渲染器接口旋转相机
      // RendererAdapter 提供 setCameraRotation 或通过事件通知
      // 使用 player.emit 通知渲染器更新相机
      ctx.player.emit('autorotate:frame', {
        axis,
        delta: deltaDeg,
      });
    },

    destroy() {
      if (pointerDownHandler) {
        ctx?.container.removeEventListener('pointerdown', pointerDownHandler);
        pointerDownHandler = null;
      }
      if (wheelHandler) {
        ctx?.container.removeEventListener('wheel', wheelHandler);
        wheelHandler = null;
      }
      if (keyDownHandler) {
        window.removeEventListener('keydown', keyDownHandler);
        keyDownHandler = null;
      }
      if (interactionTimeout) {
        clearTimeout(interactionTimeout);
        interactionTimeout = null;
      }
      // ★ N-07: 注销减弱动效监听 (兼容旧浏览器无 removeEventListener 的情况)
      if (reducedMotionQuery && reducedMotionHandler) {
        reducedMotionQuery.removeEventListener?.('change', reducedMotionHandler);
        reducedMotionQuery = null;
        reducedMotionHandler = null;
      }
    },
  };

  // ─── 内部方法 ────────────────────────────────────────────

  function onUserInteraction(): void {
    if (!isActive) return;
    lastInteractionTime = performance.now();
    if (!isPaused) {
      isPaused = true;
      ctx.player.emit('autorotate:paused', {});
    }
  }
}
