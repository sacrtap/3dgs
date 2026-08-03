# 插件系统

## 插件接口

```typescript
interface TourPlugin {
  name: string;
  version: string;
  init?(ctx: TourPluginContext): void;
  update?(ctx: FrameContext): void;
  destroy?(): void;
}

interface TourPluginContext {
  player: TourPlayer;
  sceneManager?: SceneManager;
  renderer?: RendererAdapter;
  container: HTMLElement;
}
```

## 官方插件

| 插件 | 创建函数 | 说明 |
|------|---------|------|
| HotspotSystem | `createHotspotSystem()` | 3D 热点系统 (标注、跳转、深度遮挡) |
| CameraControls | `createCameraControls()` | 相机控制增强 |
| DepthOcclusion | `createDepthOcclusionPlugin()` | 热点深度遮挡检测 |
| TouchGestures | `createTouchGesturesPlugin()` | 多指触摸手势 (捏合/旋转/惯性) |
| SceneTransition | `createSceneTransitionPlugin()` | 场景过渡动画 (fade/fly/instant) |
| Fullscreen | `createFullscreenPlugin()` | 全屏切换 |
| LoadingIndicator | `createLoadingIndicatorPlugin()` | 加载进度指示器 |
| AutoRotate | `createAutoRotatePlugin()` | 自动旋转 |
| ShaderInjection | `createShaderInjectionPlugin()` | 自定义 Shader 注入 |

## 使用插件

```typescript
import { createHotspotSystem, createFullscreenPlugin } from '@3dgs/plugins';

player.use(createHotspotSystem());
player.use(createFullscreenPlugin({ enableDoubleClick: true }));
```

## 插件生命周期

```
player.use(plugin)
  │
  ├── plugin.init(ctx)      // 初始化, 获取 player/renderer/container
  │
  ├── plugin.update(ctx)    // 每帧调用 (如果定义了 update)
  │     └── ctx.deltaTime   // 帧间隔 (ms)
  │
  └── plugin.destroy()      // 销毁, 清理资源
```

## 编写自定义插件

```typescript
import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';

export function createMyPlugin(): TourPlugin {
  let ctx: TourPluginContext;

  return {
    name: 'my-plugin',
    version: '0.1.0',

    init(pluginCtx) {
      ctx = pluginCtx;
      ctx.player.on('scene:switched', (data) => {
        console.log('切换到:', data);
      });
    },

    update(frameCtx: FrameContext) {
      // 每帧逻辑
    },

    destroy() {
      // 清理
    },
  };
}
```
