/**
 * SceneTransition — 场景过渡动画插件
 *
 * 支持三种过渡类型:
 *   - fade:    CSS overlay 淡入淡出 (最常用, 兼容性最好)
 *   - fly:     相机沿路径飞行 (需要渲染器支持相机控制)
 *   - instant: 无动画直接切换
 *
 * 工作流程:
 *   1. 监听 scene:switching 事件 → 执行 fade-out (遮罩变为不透明)
 *   2. 场景在遮罩下完成加载和切换
 *   3. 监听 scene:switched 事件 → 执行 fade-in (遮罩变为透明)
 *   4. 对于 fly 类型: scene:switched 后动画相机 yaw/pitch/fov
 *
 * [来源: TourPlayer 事件系统 — packages/core/src/tour-player.ts]
 * [来源: SceneTransition 配置 — packages/core/src/tour-config.ts]
 */

import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';
import type { SceneTransition } from '@3dgs/core';

/** 场景过渡插件选项 */
export interface SceneTransitionOptions {
  /** 默认过渡类型 (默认 'fade') */
  defaultType?: 'fade' | 'fly' | 'instant';
  /** 默认过渡持续时间 (ms, 默认 800) */
  defaultDuration?: number;
  /** fade 遮罩颜色 (默认 '#000000') */
  fadeColor?: string;
  /** fly 飞行缓动函数 */
  flyEasing?: 'linear' | 'easeInOut' | 'easeOut';
}

/** 缓动函数类型 */
type EasingFn = (t: number) => number;

/** 缓动函数实现 */
const EASINGS: Record<string, EasingFn> = {
  linear: (t) => t,
  easeInOut: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
};

/** fly 动画状态 */
interface FlyState {
  /** 起始 yaw */
  fromYaw: number;
  /** 起始 pitch */
  fromPitch: number;
  /** 起始 fov */
  fromFov: number;
  /** 目标 yaw */
  toYaw: number;
  /** 目标 pitch */
  toPitch: number;
  /** 目标 fov */
  toFov: number;
  /** 动画持续时间 (ms) */
  duration: number;
  /** 已经过时间 (ms) */
  elapsed: number;
  /** 缓动函数 */
  easing: EasingFn;
}

/**
 * 创建场景过渡动画插件
 *
 * @example
 * ```typescript
 * player.use(createSceneTransitionPlugin({ defaultType: 'fade', defaultDuration: 800 }));
 * ```
 */
export function createSceneTransitionPlugin(
  options: SceneTransitionOptions = {},
): TourPlugin {
  const {
    defaultType = 'fade',
    defaultDuration = 800,
    fadeColor = '#000000',
    flyEasing = 'easeInOut',
  } = options;

  let ctx: TourPluginContext;
  let overlay: HTMLDivElement | null = null;

  // fade 状态
  let fadeState: 'idle' | 'fading-out' | 'fading-in' = 'idle';
  let fadeStartTime = 0;
  let fadeDuration = defaultDuration;

  // fly 状态
  let flyState: FlyState | null = null;

  // 记录上一个场景的过渡配置
  let pendingTransition: Partial<SceneTransition> | undefined;

  return {
    name: 'scene-transition',
    version: '0.1.0',

    init(pluginCtx: TourPluginContext) {
      ctx = pluginCtx;

      // 创建 fade 遮罩层
      overlay = document.createElement('div');
      overlay.className = '3dgs-transition-overlay';
      Object.assign(overlay.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        background: fadeColor,
        opacity: '0',
        zIndex: '9999',
        transition: `opacity ${fadeDuration}ms ease`,
      } as Partial<CSSStyleDeclaration>);
      ctx.container.appendChild(overlay);

      // 注入 CSS (确保 transition 属性不被覆盖)
      SceneTransitionPlugin.injectStyles();

      // 监听场景切换前事件 → fade-out
      ctx.player.on('scene:switching', (data) => {
        const d = data as { sceneId: string; transition?: Partial<SceneTransition> };
        pendingTransition = d.transition;
        const transType = d.transition?.type ?? defaultType;
        const duration = d.transition?.duration ?? defaultDuration;

        if (transType === 'fade') {
          startFadeOut(duration);
        }
        // fly 和 instant 不需要 fade-out
      });

      // 监听场景切换完成事件 → fade-in / fly
      ctx.player.on('scene:switched', (data) => {
        const d = data as { sceneId: string; scene?: { config?: { initialView?: { yaw: number; pitch: number; fov: number } } } };
        const transType = pendingTransition?.type ?? defaultType;
        const duration = pendingTransition?.duration ?? defaultDuration;

        if (transType === 'fade' && fadeState === 'fading-out') {
          // 遮罩已不透明 → 开始 fade-in
          startFadeIn(duration);
        } else if (transType === 'fly') {
          // 启动相机飞行动画
          startFlyAnimation(d, duration);
        }
        // instant: 无动画
      });
    },

    update(frameCtx: FrameContext) {
      // 处理 fade 动画
      if (fadeState === 'fading-out' || fadeState === 'fading-in') {
        const now = performance.now();
        const elapsed = now - fadeStartTime;
        const progress = Math.min(elapsed / fadeDuration, 1);

        if (fadeState === 'fading-out') {
          if (overlay) {
            overlay.style.opacity = String(progress);
          }
          if (progress >= 1) {
            fadeState = 'idle'; // 等待 scene:switched 触发 fade-in
          }
        } else if (fadeState === 'fading-in') {
          if (overlay) {
            overlay.style.opacity = String(1 - progress);
          }
          if (progress >= 1) {
            fadeState = 'idle';
            if (overlay) {
              overlay.style.opacity = '0';
            }
          }
        }
      }

      // 处理 fly 动画
      if (flyState) {
        flyState.elapsed += frameCtx.deltaTime;
        const t = Math.min(flyState.elapsed / flyState.duration, 1);
        const eased = flyState.easing(t);

        const yaw = lerpAngle(flyState.fromYaw, flyState.toYaw, eased);
        const pitch = lerp(flyState.fromPitch, flyState.toPitch, eased);
        const fov = lerp(flyState.fromFov, flyState.toFov, eased);

        // 通过 renderer 的 onFrame 间接控制相机
        // 注意: 由于 RendererAdapter 不直接暴露相机控制,
        // fly 动画通过事件总线通知渲染器
        ctx.player.emit('transition:fly:frame', { yaw, pitch, fov });

        if (t >= 1) {
          flyState = null;
          ctx.player.emit('transition:fly:complete', {});
        }
      }
    },

    destroy() {
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      fadeState = 'idle';
      flyState = null;
    },
  };

  // ─── 内部方法 ────────────────────────────────────────────

  function startFadeOut(duration: number): void {
    if (!overlay) return;
    fadeDuration = duration;
    fadeState = 'fading-out';
    fadeStartTime = performance.now();
    overlay.style.transition = `opacity ${duration}ms ease`;
    overlay.style.opacity = '1';
  }

  function startFadeIn(duration: number): void {
    if (!overlay) return;
    fadeDuration = duration;
    fadeState = 'fading-in';
    fadeStartTime = performance.now();
    overlay.style.transition = `opacity ${duration}ms ease`;
    overlay.style.opacity = '0';
  }

  function startFlyAnimation(
    data: { sceneId: string; scene?: { config?: { initialView?: { yaw: number; pitch: number; fov: number } } } },
    duration: number,
  ): void {
    const initialView = data.scene?.config?.initialView;
    if (!initialView) return;

    // 获取当前相机位置 (从 frameCtx 获取)
    // 注意: 这里使用 transition 配置中的 targetYaw/Pitch/Fov 作为起点
    // initialView 作为终点
    const fromYaw = pendingTransition?.targetYaw ?? 0;
    const fromPitch = pendingTransition?.targetPitch ?? 0;
    const fromFov = pendingTransition?.targetFov ?? 60;

    flyState = {
      fromYaw,
      fromPitch,
      fromFov,
      toYaw: initialView.yaw,
      toPitch: initialView.pitch,
      toFov: initialView.fov,
      duration,
      elapsed: 0,
      easing: EASINGS[flyEasing] ?? EASINGS.easeInOut,
    };
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────

/** 线性插值 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 角度插值 (处理 -180~180 环绕) */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  else if (diff < -180) diff += 360;
  return a + diff * t;
}

// ─── 插件静态方法 ──────────────────────────────────────────

const SceneTransitionPlugin = {
  /** 注入 CSS 样式 */
  injectStyles(): void {
    if (document.getElementById('3dgs-transition-styles')) return;
    const style = document.createElement('style');
    style.id = '3dgs-transition-styles';
    style.textContent = `
      .3dgs-transition-overlay {
        will-change: opacity;
      }
    `;
    document.head.appendChild(style);
  },
};
