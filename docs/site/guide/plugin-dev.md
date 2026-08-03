# 插件开发

## TourPlugin 接口

```typescript
interface TourPlugin {
  name: string;
  version: string;
  init?(ctx: TourPluginContext): void;
  update?(ctx: FrameContext): void;
  destroy?(): void;
}
```

## 插件上下文

```typescript
interface TourPluginContext {
  player: TourPlayer;      // 播放器实例
  sceneManager?: SceneManager; // 场景管理器
  renderer?: RendererAdapter;  // 渲染器
  container: HTMLElement;       // DOM 容器
}

interface FrameContext {
  camera: { x: number; y: number; z: number };
  vpMatrix: Float32Array;
  size: { width: number; height: number };
  sceneManager?: SceneManager;
  deltaTime: number; // 帧间隔 (ms)
}
```

## 完整示例

```typescript
import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';

export interface MyPluginOptions {
  message?: string;
  interval?: number;
}

export function createMyPlugin(options: MyPluginOptions = {}): TourPlugin {
  const { message = 'Hello', interval = 1000 } = options;

  let ctx: TourPluginContext;
  let lastTrigger = 0;

  return {
    name: 'my-plugin',
    version: '0.1.0',

    init(pluginCtx) {
      ctx = pluginCtx;

      // 监听事件
      ctx.player.on('scene:switched', (data) => {
        console.log(`${message}: 场景已切换`, data);
      });

      // 操作 DOM
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:10px;left:10px;color:#fff;';
      el.textContent = message;
      ctx.container.appendChild(el);
    },

    update(frameCtx: FrameContext) {
      const now = performance.now();
      if (now - lastTrigger >= interval) {
        lastTrigger = now;
        // 定时逻辑
      }

      // 访问相机位置
      const { x, y, z } = frameCtx.camera;
      // 访问视图投影矩阵
      const vp = frameCtx.vpMatrix;
    },

    destroy() {
      // 清理 DOM、事件监听器等
    },
  };
}
```

## 发布插件

1. 创建 npm 包 (`@your-org/3dgs-plugin-xxx`)
2. 依赖 `@3dgs/core` (peerDependency)
3. 导出 `createXxxPlugin` 工厂函数
4. 导出 `XxxOptions` 类型

```json
{
  "name": "@your-org/3dgs-plugin-xxx",
  "peerDependencies": {
    "@3dgs/core": "^0.1.0"
  }
}
```
