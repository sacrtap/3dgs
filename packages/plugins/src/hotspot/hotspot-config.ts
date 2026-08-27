/**
 * HotspotConfig — 热点配置类型
 *
 * v4.1: 从 @3dgs/core 迁移至 @3dgs/plugins
 * 热点配置通过 SceneConfig.extensions.hotspot 挂载
 */

export type HotspotType = 'image' | 'text' | 'scene' | 'url' | 'custom';

export interface HotspotStyle {
  icon?: string;
  size?: number;
  color?: string;
  opacity?: number;
  scale?: number;
  glow?: boolean;
  pulse?: boolean;
}

export interface HotspotHover {
  tooltip?: string;
  scale?: number;
  animation?: string;
}

export interface HotspotVisibility {
  minDistance?: number;
  maxDistance?: number;
  yawRange?: [number, number];
  occlusionTest?: boolean;
}

export interface HotspotAction {
  url?: string;
  target?: string;
  callback?: string;
}

/** ★ 热点点击弹出面板配置 (点击热点后在屏幕空间弹出) */
export interface HotspotPopup {
  /** 弹层标题 (可选) */
  title?: string;
  /** 文本或 HTML 片段内容 */
  content?: string;
  /** 弹层内嵌图片 URL (可选) */
  imageUrl?: string;
  /** 弹层宽度 (px, 默认 280) */
  width?: number;
  /** 弹出位置: auto=跟随热点并防越界 / center=屏幕居中 (默认 auto) */
  placement?: 'auto' | 'center';
  /** 是否可点击遮罩/关闭按钮关闭 (默认 true) */
  dismissible?: boolean;
}

export interface HotspotConfig {
  id: string;
  type: HotspotType;
  position: [number, number, number];

  style?: HotspotStyle;
  onClick?: HotspotAction;
  onHover?: HotspotHover;
  visibility?: HotspotVisibility;

  /** ★ 点击弹出面板 (可选; 配置后点击热点自动弹出) */
  popup?: HotspotPopup;

  /** 场景跳转目标 (type='scene' 时必需) */
  targetScene?: string;
  transition?: import('@3dgs/core').SceneTransition;
}

/** 场景扩展中的热点配置结构 */
export interface HotspotExtension {
  hotspots: HotspotConfig[];
}
