/**
 * @3dgs/plugins — 3DGS 漫游框架插件包
 *
 * 包含:
 *   - HotspotSystem: 热点系统插件 (场景跳转、信息标注)
 *   - CameraControls: 相机控制插件 (触摸/拖拽/缩放)
 *   - DepthOcclusion: 深度遮挡检测插件 (热点遮挡半透明)
 *   - TouchGestures: 多指触摸手势插件 (捏合缩放/双指旋转/惯性)
 *   - SceneTransition: 场景过渡动画插件 (fade/fly/instant)
 */

// 热点系统
export { createHotspotSystem } from './hotspot/index.js';
export { HotspotManager } from './hotspot/hotspot-manager.js';
export type { HotspotSystemOptions } from './hotspot/index.js';
export type {
  HotspotConfig,
  HotspotExtension,
  HotspotType,
  HotspotStyle,
  HotspotVisibility,
  HotspotAction,
  HotspotHover,
} from './hotspot/hotspot-config.js';
export type { HotspotInstance } from './hotspot/hotspot-manager.js';

// 相机控制
export { createCameraControls } from './camera-controls/index.js';
export type { CameraControlsOptions } from './camera-controls/index.js';

// 深度遮挡检测
export { createDepthOcclusionPlugin } from './depth-occlusion/index.js';
export type { DepthOcclusionOptions } from './depth-occlusion/index.js';

// 多指触摸手势
export { createTouchGesturesPlugin } from './touch-gestures/index.js';
export type { TouchGesturesOptions } from './touch-gestures/index.js';

// 场景过渡动画
export { createSceneTransitionPlugin } from './scene-transition/index.js';
export type { SceneTransitionOptions } from './scene-transition/index.js';

// 全屏
export { createFullscreenPlugin } from './fullscreen/index.js';
export type { FullscreenOptions } from './fullscreen/index.js';

// 加载指示器
export { createLoadingIndicatorPlugin } from './loading-indicator/index.js';
export type { LoadingIndicatorOptions } from './loading-indicator/index.js';

// 自动旋转
export { createAutoRotatePlugin } from './auto-rotate/index.js';
export type { AutoRotateOptions } from './auto-rotate/index.js';

// Shader 注入
export { createShaderInjectionPlugin, createShaderInjection } from './shader-injection/index.js';
export type { ShaderInjectionPluginOptions } from './shader-injection/index.js';
