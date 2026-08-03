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

## DepthOcclusionOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sampleInterval` | `number` | 2 | 采样间隔 (帧) |
| `occludedOpacity` | `number` | 0.3 | 遮挡时透明度 |

## TouchGesturesOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pinchSensitivity` | `number` | 1.0 | 捏合灵敏度 |
| `rotationSensitivity` | `number` | 1.0 | 旋转灵敏度 |
| `inertiaDamping` | `number` | 0.95 | 惯性阻尼 |

## AutoRotateOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `speed` | `number` | 10 | 旋转速度 (度/秒) |
| `enabled` | `boolean` | false | 是否默认启用 |
| `idleDelay` | `number` | 3000 | 交互后恢复延迟 (ms) |
| `direction` | `1 \| -1` | 1 | 旋转方向 |
| `axis` | `'yaw' \| 'pitch'` | 'yaw' | 旋转轴 |
