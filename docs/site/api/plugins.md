# @3dgs/plugins

官方插件包。

## 导出

| 工厂函数 | 选项类型 |
|---------|---------|
| `createHotspotSystem()` | `HotspotSystemOptions` |
| `createCameraControls()` | `CameraControlsOptions` |
| `createDepthOcclusionPlugin()` | `DepthOcclusionOptions` |
| `createTouchGesturesPlugin()` | `TouchGesturesOptions` |
| `createSceneTransitionPlugin()` | `SceneTransitionOptions` |
| `createFullscreenPlugin()` | `FullscreenOptions` |
| `createLoadingIndicatorPlugin()` | `LoadingIndicatorOptions` |
| `createAutoRotatePlugin()` | `AutoRotateOptions` |
| `createShaderInjectionPlugin()` | `ShaderInjectionPluginOptions` |
| `createShaderInjection()` | `ShaderInjection` (单个注入) |

## 使用示例

```typescript
import {
  createHotspotSystem,
  createDepthOcclusionPlugin,
  createTouchGesturesPlugin,
  createFullscreenPlugin,
  createLoadingIndicatorPlugin,
  createAutoRotatePlugin,
  createSceneTransitionPlugin,
  createShaderInjectionPlugin,
} from '@3dgs/plugins';

player.use(createHotspotSystem());
player.use(createDepthOcclusionPlugin({ sampleInterval: 2 }));
player.use(createTouchGesturesPlugin());
player.use(createFullscreenPlugin({ enableDoubleClick: true }));
player.use(createLoadingIndicatorPlugin({ text: '加载中...', showProgress: true }));
player.use(createAutoRotatePlugin({ speed: 8, idleDelay: 5000 }));
player.use(createSceneTransitionPlugin({ defaultDuration: 800 }));
```

## HotspotSystemOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `preloadTargets` | `boolean` | `true` | 是否自动预加载场景跳转目标 |

## CameraControlsOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableZoom` | `boolean` | `true` | 启用缩放 |
| `enablePan` | `boolean` | — | 启用平移 |
| `enableRotate` | `boolean` | `true` | 启用旋转 |
| `minDistance` | `number` | 0.3 | 最小缩放距离 |
| `maxDistance` | `number` | 20 | 最大缩放距离 |
| `minPolarAngle` | `number` | 0 | 最小垂直角度 (弧度) |
| `maxPolarAngle` | `number` | `Math.PI * 0.85` | 最大垂直角度 (弧度) |
| `dampingFactor` | `number` | 0.08 | 阻尼系数 |

## DepthOcclusionOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sampleInterval` | `number` | 2 | 降频采样间隔 (帧) |
| `depthThreshold` | `number` | 0.001 | 遮挡判定深度阈值 (0-1) |
| `occludedOpacity` | `number` | 0.3 | 被遮挡时的不透明度 |
| `normalOpacity` | `number` | 1.0 | 正常不透明度 |
| `hotspotSelector` | `string` | `'[data-hotspot]'` | 热点元素 CSS 选择器 |

## TouchGesturesOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pinchSensitivity` | `number` | 0.01 | 捏合缩放灵敏度 |
| `rotationSensitivity` | `number` | 0.005 | 双指旋转灵敏度 (弧度/像素) |
| `inertiaDamping` | `number` | 0.92 | 惯性阻尼系数 (0-1, 越大衰减越快) |
| `minFov` | `number` | 30 | 最小 FOV |
| `maxFov` | `number` | 100 | 最大 FOV |

## SceneTransitionOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `defaultType` | `'fade' \| 'fly' \| 'instant'` | `'fade'` | 默认过渡类型 |
| `defaultDuration` | `number` | 800 | 默认过渡持续时间 (ms) |
| `fadeColor` | `string` | `'#000000'` | fade 遮罩颜色 |
| `flyEasing` | `'linear' \| 'easeInOut' \| 'easeOut'` | `'easeInOut'` | fly 飞行缓动函数 |

## FullscreenOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableDoubleClick` | `boolean` | `true` | 启用双击切换全屏 |
| `target` | `HTMLElement` | `container` | 全屏目标元素 |

## LoadingIndicatorOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `template` | `string` | — | 自定义加载指示器 HTML (默认 spinner) |
| `text` | `string` | `'加载中...'` | 加载文本 |
| `background` | `string` | `'rgba(0,0,0,0.7)'` | 背景色 |
| `color` | `string` | `'#ffffff'` | 文字颜色 |
| `spinnerColor` | `string` | `'#ffffff'` | spinner 颜色 |
| `fadeDuration` | `number` | 300 | 淡入淡出动画时长 (ms) |
| `showProgress` | `boolean` | `false` | 是否显示进度百分比 |

## AutoRotateOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `speed` | `number` | 10 | 旋转速度 (度/秒) |
| `enabled` | `boolean` | `false` | 是否默认启用 |
| `idleDelay` | `number` | 3000 | 交互后恢复延迟 (ms) |
| `direction` | `1 \| -1` | 1 | 旋转方向 (1=右, -1=左) |
| `axis` | `'yaw' \| 'pitch'` | `'yaw'` | 旋转轴 |
| `pauseOnInteraction` | `boolean` | `true` | 用户交互时是否自动暂停 |

## ShaderInjectionPluginOptions

| 选项 | 类型 | 说明 |
|------|------|------|
| `injections` | `ShaderInjection[]` | 要注入的 Shader 定义列表 |

详见 [Shader 注入指南](/guide/shader-injection) 和 [`@3dgs/core` API — ShaderInjection](/api/core#shaderinjection)。
