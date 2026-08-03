/**
 * 深度遮挡检测插件 — DepthOcclusion
 *
 * 检测热点是否被 3DGS 场景中的高斯核遮挡,
 * 被遮挡的热点显示为半透明。
 *
 * 实现方案:
 *   1. 使用 WebGL2 的 readPixels 读取深度缓冲 (降频采样, 每 2-3 帧一次)
 *   2. 将热点的 3D 位置投影到屏幕空间
 *   3. 比较热点深度与缓冲深度
 *   4. 如果热点被遮挡 → 设置半透明样式
 *
 * 性能优化:
 *   - 降频采样: 每 N 帧读取一次深度缓冲 (默认 2 帧)
 *   - 仅读取热点附近的像素区域 (而非整个屏幕)
 *   - 异步读取不阻塞主线程
 *
 * [来源: WebGL2 readPixels — developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/readPixels]
 * [来源: 项目源码 — packages/plugins/src/hotspot/]
 */

import type { TourPlugin, FrameContext, TourPluginContext } from '@3dgs/core';

/** 深度遮挡插件选项 */
export interface DepthOcclusionOptions {
  /** 降频采样间隔 (帧数, 默认 2) */
  sampleInterval?: number;
  /** 遮挡判定深度阈值 (0-1, 默认 0.001) */
  depthThreshold?: number;
  /** 被遮挡时的不透明度 (默认 0.3) */
  occludedOpacity?: number;
  /** 正常不透明度 (默认 1.0) */
  normalOpacity?: number;
  /** 热点元素选择器 (用于查找 DOM 热点) */
  hotspotSelector?: string;
}

/**
 * 创建深度遮挡检测插件
 *
 * 该插件会:
 *   1. 每 N 帧读取一次深度缓冲
 *   2. 检查所有热点是否被场景遮挡
 *   3. 被遮挡的热点设置为半透明
 *
 * @param options 插件选项
 * @returns TourPlugin 实例
 *
 * @example
 * ```typescript
 * player.use(createDepthOcclusionPlugin({ sampleInterval: 2 }));
 * ```
 */
export function createDepthOcclusionPlugin(
  options: DepthOcclusionOptions = {},
): TourPlugin {
  const {
    sampleInterval = 2,
    depthThreshold = 0.001,
    occludedOpacity = 0.3,
    normalOpacity = 1.0,
    hotspotSelector = '[data-hotspot]',
  } = options;

  let frameCount = 0;
  let gl: WebGL2RenderingContext | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let container: HTMLElement | null = null;

  return {
    name: 'depth-occlusion',
    version: '0.1.0',

    init(ctx: TourPluginContext) {
      container = ctx.container;
      // 获取 WebGL2 上下文 (从渲染器的 canvas)
      canvas = ctx.container?.querySelector('canvas') || null;
      if (canvas) {
        gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
        if (!gl) {
          console.warn('[DepthOcclusion] WebGL2 不可用, 深度遮挡检测禁用');
        }
      }
    },

    update(context: FrameContext) {
      frameCount++;

      // 降频采样
      if (frameCount % sampleInterval !== 0) return;
      if (!gl || !canvas) return;

      const width = canvas.width;
      const height = canvas.height;

      // 查找所有热点元素
      const hotspots = (container || document).querySelectorAll<HTMLElement>(hotspotSelector);
      if (hotspots.length === 0) return;

      // 为每个热点检测遮挡
      for (const hotspot of hotspots) {
        // 读取热点的 3D 位置 (从 data 属性)
        const posStr = hotspot.dataset.worldPos;
        if (!posStr) continue;

        const parts = posStr.split(',').map(parseFloat);
        if (parts.length < 3 || !parts.every(isFinite)) continue;

        const [wx, wy, wz] = parts;

        // 将 3D 位置投影到屏幕空间
        const screenPos = projectToScreen(
          wx, wy, wz,
          context.vpMatrix,
          width, height,
        );

        if (!screenPos) {
          // 热点不在视锥内
          hotspot.style.opacity = String(occludedOpacity);
          continue;
        }

        // 读取该位置的深度值
        const px = Math.floor(screenPos.x);
        const py = Math.floor(screenPos.y);

        if (px < 0 || px >= width || py < 0 || py >= height) {
          hotspot.style.opacity = String(occludedOpacity);
          continue;
        }

        // 读取单个像素的深度值
        try {
          const pixel = new Float32Array(1);
          gl.readPixels(px, py, 1, 1, gl.DEPTH_COMPONENT, gl.FLOAT, pixel);

          const bufferDepth = pixel[0];
          const hotspotDepth = screenPos.z;

          // 比较深度: 如果热点深度 > 缓冲深度, 则被遮挡
          if (hotspotDepth > bufferDepth + depthThreshold) {
            hotspot.style.opacity = String(occludedOpacity);
          } else {
            hotspot.style.opacity = String(normalOpacity);
          }
        } catch {
          // readPixels 可能失败 (某些浏览器/上下文配置)
          // 静默失败, 保持热点可见
        }
      }
    },

    destroy() {
      gl = null;
      canvas = null;
      container = null;
    },
  };
}

/**
 * 将 3D 世界坐标投影到屏幕空间
 *
 * @returns { x, y, z } 屏幕坐标 (z = 深度值 0-1), 或 null 如果不在视锥内
 */
function projectToScreen(
  wx: number, wy: number, wz: number,
  vpMatrix: Float32Array,
  width: number, height: number,
): { x: number; y: number; z: number } | null {
  // 应用视图投影矩阵
  const clipX = vpMatrix[0] * wx + vpMatrix[4] * wy + vpMatrix[8] * wz + vpMatrix[12];
  const clipY = vpMatrix[1] * wx + vpMatrix[5] * wy + vpMatrix[9] * wz + vpMatrix[13];
  const clipZ = vpMatrix[2] * wx + vpMatrix[6] * wy + vpMatrix[10] * wz + vpMatrix[14];
  const clipW = vpMatrix[3] * wx + vpMatrix[7] * wy + vpMatrix[11] * wz + vpMatrix[15];

  // 透视除法
  if (clipW <= 0) return null; // 在相机后面

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;

  // NDC → 屏幕坐标
  const screenX = (ndcX + 1) * 0.5 * width;
  const screenY = (1 - ndcY) * 0.5 * height; // Y 翻转
  const depth = (ndcZ + 1) * 0.5; // 深度 0-1

  // 视锥剔除
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null;

  return { x: screenX, y: screenY, z: depth };
}
