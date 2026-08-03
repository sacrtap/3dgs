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

export interface HotspotConfig {
  id: string;
  type: HotspotType;
  position: [number, number, number];

  style?: HotspotStyle;
  onClick?: HotspotAction;
  onHover?: HotspotHover;
  visibility?: HotspotVisibility;

  /** 场景跳转目标 (type='scene' 时必需) */
  targetScene?: string;
  transition?: import('@3dgs/core').SceneTransition;
}

/** 场景扩展中的热点配置结构 */
export interface HotspotExtension {
  hotspots: HotspotConfig[];
}
