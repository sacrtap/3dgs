/**
 * MediaEmbed — 空间媒体嵌入插件 (图像 / 视频)
 *
 * 将图像或视频以"空间平面"形式嵌入 3DGS 场景, 与高斯渲染无缝融合:
 *   - 世界坐标定位 (position + width/height, 世界单位)
 *   - 每帧从相机位姿计算 CSS 3D 透视变换, 与 3D 场景完全同步
 *   - 无缝融合策略: 距离淡化 (nearFade/farFade) + 深度模糊 (depthBlur)
 *     + 羽化边缘 (feather) + 透明度混合 (opacity)
 *   - 视频: 自动播放 (默认静音, 浏览器策略) / 循环 / 播放控制
 *
 * 技术路线: CSS 3D 透视叠加层 (不侵入渲染管线, WebGL/WebGPU 双后端通用)。
 * 已知限制: 媒体平面为整体叠加, 不与 splat 做像素级深度交织
 * (像素级融合需渲染管线支持, 见规划文档 §2.5)。
 *
 * 配置驱动: SceneConfig.extensions.media = { embeds: MediaEmbedConfig[] }
 * 事件: media:ready / media:error / media:click
 *
 * @example
 * ```ts
 * const mediaEmbed = createMediaEmbed();
 * player.use(mediaEmbed);
 * // 编程式添加:
 * mediaEmbed.add({ id: 'tv', type: 'video', url: '/clip.mp4',
 *   position: [0, 1.5, -2], width: 1.6, height: 0.9, autoplay: true });
 * ```
 */

import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';
import {
  extractCameraPose,
  buildWorldToCSSMatrix,
  toCSSMatrix3d,
  worldToCameraCSS,
  billboardAxes,
  fixedAxes,
  type PlaneAxes,
} from './camera-extract.js';

/** 媒体类型 */
export type MediaEmbedType = 'image' | 'video';

/** 深度模糊配置 */
export interface MediaDepthBlur {
  /** 起模糊距离 (世界单位, 默认 3) */
  start?: number;
  /** 从起模糊到最大模糊的距离范围 (默认 6) */
  range?: number;
  /** 最大模糊半径 (px, 默认 4) */
  max?: number;
}

/** 空间媒体嵌入配置 */
export interface MediaEmbedConfig {
  /** 唯一标识 */
  id: string;
  /** 媒体类型 */
  type: MediaEmbedType;
  /** 媒体资源 URL */
  url: string;
  /** 平面中心的世界坐标 */
  position: [number, number, number];
  /** 平面宽度 (世界单位) */
  width: number;
  /** 平面高度 (世界单位) */
  height: number;
  /** 整体不透明度 (0-1, 默认 1) */
  opacity?: number;
  /** 边缘羽化比例 (0-1, 默认 0.08; 0 = 硬边) */
  feather?: number;
  /** 近距离淡化距离 (相机距平面小于该值时渐隐, 避免穿帮; 默认 0 关闭) */
  nearFade?: number;
  /** 远距离淡化距离 (超过该值完全淡出; 默认 0 关闭) */
  farFade?: number;
  /** 深度模糊 (模拟远景柔化, 与 3DGS 观感融合) */
  depthBlur?: MediaDepthBlur;
  /**
   * 平面朝向:
   *   - 不设置 → 公告板模式 (始终面向相机, 水平对齐)
   *   - { yaw, pitch } → 世界固定朝向 (如墙面挂画), 法线由角度确定 (度)
   */
  orientation?: { yaw: number; pitch?: number };
  // ── 视频专属 ──
  /** 自动播放 (默认 true; 自动播放时强制静音以符合浏览器策略) */
  autoplay?: boolean;
  /** 循环播放 (默认 true) */
  loop?: boolean;
  /** 静音 (默认 true) */
  muted?: boolean;
  /** 点击视频切换播放/暂停 (默认 true) */
  toggleOnClick?: boolean;
}

/** 场景扩展中的媒体嵌入配置结构 */
export interface MediaEmbedExtension {
  embeds: MediaEmbedConfig[];
}

/** 媒体嵌入插件选项 */
export interface MediaEmbedOptions {
  /** 是否自动从 extensions.media 加载 (默认 true) */
  autoLoadFromConfig?: boolean;
}

/** 内部实例 */
interface MediaEmbedInstance {
  config: MediaEmbedConfig;
  el: HTMLDivElement;
  media: HTMLImageElement | HTMLVideoElement;
}

/** 插件对外接口 (配置驱动 + 编程式) */
export interface MediaEmbedPlugin extends TourPlugin {
  /** 编程式添加媒体平面 */
  add(config: MediaEmbedConfig): void;
  /** 移除媒体平面 */
  remove(id: string): void;
  /** 视频播放 */
  play(id: string): Promise<void> | void;
  /** 视频暂停 */
  pause(id: string): void;
  /** 设置音量 (0-1) */
  setVolume(id: string, volume: number): void;
  /** 当前媒体列表 */
  list(): MediaEmbedConfig[];
}

/** 局部像素/世界单位换算系数 (避免亚像素元素) */
const PX_PER_UNIT = 100;

/** 固定朝向平面轴缓存 (角度 → 轴向, 避免每帧重算) */
const fixedAxesCache = new Map<string, PlaneAxes>();

export function createMediaEmbed(options: MediaEmbedOptions = {}): MediaEmbedPlugin {
  const { autoLoadFromConfig = true } = options;

  let ctx: TourPluginContext | null = null;
  let overlay: HTMLDivElement | null = null;
  let unsubSceneSwitched: (() => void) | undefined;
  const instances = new Map<string, MediaEmbedInstance>();

  /** 创建叠加层 (perspective 容器) */
  function ensureOverlay(): HTMLDivElement | null {
    if (overlay || !ctx) return overlay;
    overlay = document.createElement('div');
    overlay.className = '3dgs-media-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
      perspectiveOrigin: '50% 50%',
      // ★ 叠加层置于画布之上 (canvas 为 static, 面板 z-index 10+),
      //   取 6 保证媒体在 3D 画布之上、UI 面板之下
      zIndex: '6',
    } as Partial<CSSStyleDeclaration>);
    ctx.container.appendChild(overlay);
    return overlay;
  }

  /** 创建媒体元素 */
  function createInstance(config: MediaEmbedConfig): MediaEmbedInstance | null {
    const host = ensureOverlay();
    if (!host || !ctx) return null;

    const el = document.createElement('div');
    el.className = '3dgs-media-item';
    el.dataset.mediaId = config.id;
    Object.assign(el.style, {
      position: 'absolute',
      left: '0', top: '0',
      width: `${config.width * PX_PER_UNIT}px`,
      height: `${config.height * PX_PER_UNIT}px`,
      // ★ 变换原点取左上角 (0 0), 配合 transform 中的 translate(-50%,-50%)
      //   使元素中心精确映射到 matrix3d 的 col3 (锚点投影位置)。
      //   若用默认的 center 原点, 元素中心偏移会被透视放大导致定位严重偏离。
      transformOrigin: '0 0',
      pointerEvents: 'auto',
      display: 'none',
      zIndex: '6',
      willChange: 'transform, opacity',
      // 羽化边缘: 径向渐变遮罩消除平面硬边
      ...(makeFeatherStyle(config.feather ?? 0.08)),
    } as Partial<CSSStyleDeclaration>);

    let media: HTMLImageElement | HTMLVideoElement;
    if (config.type === 'video') {
      const video = document.createElement('video');
      video.src = config.url;
      video.muted = config.muted !== false;
      video.loop = config.loop !== false;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      Object.assign(video.style, { width: '100%', height: '100%', objectFit: 'fill', display: 'block' });
      if (config.autoplay !== false) {
        // 自动播放 (静音保证浏览器策略允许); 失败时等待首次点击
        video.autoplay = true;
        video.play().catch(() => { /* 等待用户交互后播放 */ });
      }
      video.addEventListener('loadeddata', () => {
        ctx?.player.emit('media:ready', { id: config.id, type: config.type });
      });
      video.addEventListener('error', () => {
        ctx?.player.emit('media:error', { id: config.id, url: config.url });
      });
      media = video;
    } else {
      const img = document.createElement('img');
      img.src = config.url;
      img.draggable = false;
      Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'fill', display: 'block' });
      img.addEventListener('load', () => {
        ctx?.player.emit('media:ready', { id: config.id, type: config.type });
      });
      img.addEventListener('error', () => {
        ctx?.player.emit('media:error', { id: config.id, url: config.url });
      });
      media = img;
    }

    el.appendChild(media);

    // 点击交互
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (config.type === 'video' && config.toggleOnClick !== false) {
        const video = media as HTMLVideoElement;
        if (video.paused) video.play().catch(() => {}); else video.pause();
      }
      ctx?.player.emit('media:click', { id: config.id, type: config.type });
    });

    host.appendChild(el);
    return { config, el, media };
  }

  /** 羽化遮罩样式 */
  function makeFeatherStyle(feather: number): Partial<CSSStyleDeclaration> {
    const f = Math.max(0, Math.min(0.5, feather));
    if (f <= 0) return {};
    const solid = Math.round((1 - f) * 100);
    const mask = `radial-gradient(ellipse closest-side, rgba(0,0,0,1) ${solid}%, rgba(0,0,0,0) 100%)`;
    return {
      maskImage: mask,
      webkitMaskImage: mask,
    };
  }

  /** 距离淡化因子 */
  function fadeFactor(config: MediaEmbedConfig, depth: number): number {
    let factor = 1;
    if (config.nearFade && config.nearFade > 0 && depth < config.nearFade) {
      factor *= Math.max(0, depth / config.nearFade);
    }
    if (config.farFade && config.farFade > 0 && depth > config.farFade) {
      factor *= Math.max(0, 1 - (depth - config.farFade) / Math.max(1e-3, config.farFade * 0.5));
    }
    return factor;
  }

  /** 深度模糊 (px) */
  function blurAmount(config: MediaEmbedConfig, depth: number): number {
    const db = config.depthBlur;
    if (!db) return 0;
    const start = db.start ?? 3;
    const range = db.range ?? 6;
    const max = db.max ?? 4;
    if (depth <= start) return 0;
    return Math.min(max, ((depth - start) / range) * max);
  }

  /** 设置全部媒体 (场景切换时) */
  function setEmbeds(embeds: MediaEmbedConfig[]): void {
    // 清理旧实例 (视频先暂停, 避免后台播放)
    for (const inst of instances.values()) {
      if (inst.media instanceof HTMLVideoElement) inst.media.pause();
      inst.el.remove();
    }
    instances.clear();
    for (const config of embeds) {
      const inst = createInstance(config);
      if (inst) instances.set(config.id, inst);
    }
  }

  const plugin: MediaEmbedPlugin = {
    name: 'media-embed',
    version: '0.1.0',

    init(pluginCtx) {
      ctx = pluginCtx;
      ensureOverlay();

      if (autoLoadFromConfig) {
        unsubSceneSwitched = ctx.player.on('scene:switched', (data) => {
          const d = data as { scene?: { config?: { extensions?: Record<string, unknown> } } };
          const ext = d.scene?.config?.extensions?.media as MediaEmbedExtension | undefined;
          setEmbeds(ext?.embeds ?? []);
        });
      }
    },

    update(frameCtx: FrameContext) {
      if (!overlay || instances.size === 0) return;

      const pose = extractCameraPose(frameCtx.vpMatrix);
      if (!pose) return;

      // 叠加层透视焦距 (仅 3D 固定朝向模式需要)
      const fy = (pose.p1 * frameCtx.size.height) / 2;
      overlay.style.perspective = `${fy.toFixed(2)}px`;

      for (const inst of instances.values()) {
        const { config, el } = inst;
        const cs = worldToCameraCSS(pose, config.position);

        // 相机后方或过近 → 隐藏
        if (cs.depth <= 0.05) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = 'block';

        if (config.orientation) {
          // ── 3D 固定朝向 (墙面挂画): matrix3d 透视变换 ──
          const key = `${config.orientation.yaw}:${config.orientation.pitch ?? 0}`;
          let cached = fixedAxesCache.get(key);
          if (!cached) {
            cached = fixedAxes(config.orientation.yaw, config.orientation.pitch ?? 0);
            fixedAxesCache.set(key, cached);
          }
          const m = buildWorldToCSSMatrix(pose, frameCtx.size.width, frameCtx.size.height, config.position, cached, PX_PER_UNIT);
          el.style.width = `${config.width * PX_PER_UNIT}px`;
          el.style.height = `${config.height * PX_PER_UNIT}px`;
          el.style.left = '0';
          el.style.top = '0';
          el.style.transform = `${toCSSMatrix3d(m)} translate(-50%, -50%)`;
        } else {
          // ── 2D 公告板 (默认): 屏幕空间投影, 稳健可靠 ──
          const scale = fy / cs.depth; // 每世界单位像素
          const screenX = frameCtx.size.width / 2 + (cs.x * fy) / cs.depth;
          const screenY = frameCtx.size.height / 2 + (cs.y * fy) / cs.depth;
          el.style.width = `${(config.width * scale).toFixed(2)}px`;
          el.style.height = `${(config.height * scale).toFixed(2)}px`;
          el.style.left = `${screenX.toFixed(2)}px`;
          el.style.top = `${screenY.toFixed(2)}px`;
          el.style.transform = 'translate(-50%, -50%)';
        }

        // 无缝融合: 距离淡化 + 深度模糊 + 透明度
        const fade = fadeFactor(config, cs.depth);
        el.style.opacity = String(Math.max(0, Math.min(1, (config.opacity ?? 1) * fade)));
        const blur = blurAmount(config, cs.depth);
        el.style.filter = blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : 'none';
      }
    },

    destroy() {
      unsubSceneSwitched?.();
      setEmbeds([]);
      overlay?.remove();
      overlay = null;
      ctx = null;
    },

    // ── 编程式 API ──
    add(config: MediaEmbedConfig) {
      if (instances.has(config.id)) plugin.remove(config.id);
      const inst = createInstance(config);
      if (inst) instances.set(config.id, inst);
    },

    remove(id: string) {
      const inst = instances.get(id);
      if (!inst) return;
      if (inst.media instanceof HTMLVideoElement) inst.media.pause();
      inst.el.remove();
      instances.delete(id);
    },

    play(id: string) {
      const inst = instances.get(id);
      if (inst?.media instanceof HTMLVideoElement) return inst.media.play();
    },

    pause(id: string) {
      const inst = instances.get(id);
      if (inst?.media instanceof HTMLVideoElement) inst.media.pause();
    },

    setVolume(id: string, volume: number) {
      const inst = instances.get(id);
      if (inst?.media instanceof HTMLVideoElement) {
        inst.media.volume = Math.max(0, Math.min(1, volume));
      }
    },

    list() {
      return Array.from(instances.values()).map((i) => i.config);
    },
  };

  return plugin;
}

export { extractCameraPose, buildWorldToCSSMatrix, worldToCameraCSS, toCSSMatrix3d, billboardAxes, fixedAxes };
export type { CameraPose, CameraSpacePoint, PlaneAxes } from './camera-extract.js';
