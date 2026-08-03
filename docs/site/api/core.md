# @3dgs/core

核心框架包，提供 TourPlayer、SceneManager、PluginSystem 等核心 API。

## TourPlayer

漫游播放器，核心编排器。

```typescript
import { TourPlayer } from '@3dgs/core';

const player = new TourPlayer(container: HTMLElement);
```

### 方法

| 方法 | 说明 |
|------|------|
| `setRenderer(renderer)` | 设置渲染器 |
| `load(config)` | 加载漫游配置 (对象或 URL) |
| `switchScene(sceneId)` | 切换到指定场景 |
| `use(plugin)` | 注册插件 |
| `on(event, handler)` | 监听事件 |
| `emit(event, data)` | 触发事件 |
| `getSceneManager()` | 获取场景管理器 |
| `getRenderer()` | 获取渲染器 |
| `getContainer()` | 获取 DOM 容器 |
| `destroy()` | 销毁播放器 |

### 事件

| 事件 | 说明 |
|------|------|
| `load` | 配置加载完成 |
| `scene:switching` | 场景切换开始 |
| `scene:switched` | 场景切换完成 |
| `hotspot:click` | 热点点击 |
| `hotspot:hover` | 热点悬停 |
| `error` | 错误 |

## RendererAdapter

渲染器抽象接口。

### 方法

| 方法 | 说明 |
|------|------|
| `mount(container)` | 挂载到 DOM |
| `start()` | 开始渲染 |
| `stop()` | 停止渲染 |
| `loadScene(source, options?)` | 加载场景 |
| `getViewProjectionMatrix()` | 获取 VP 矩阵 |
| `getCameraPosition()` | 获取相机位置 |
| `getSize()` | 获取视口尺寸 |
| `getDeviceTier()` | 获取设备分级 |
| `setResolutionScale(scale)` | 设置分辨率缩放 |
| `onFrame(callback)` | 注册帧回调 |
| `addShaderInjection(injection)` | 添加 Shader 注入 |
| `removeShaderInjection(id)` | 移除 Shader 注入 |
| `destroy()` | 销毁 |

## DeviceTier

```typescript
enum DeviceTier {
  LOW,     // 250K splats, 0.5x 分辨率
  MEDIUM,  // 500K splats, 0.75x 分辨率
  HIGH,    // 1M splats, 1.0x 分辨率
  ULTRA,   // 2.5M splats, 1.0x 分辨率
}
```

## ShaderHookPoint

```typescript
enum ShaderHookPoint {
  VERTEX_MAIN_BEGIN,
  VERTEX_BEFORE_POSITION,
  VERTEX_MAIN_END,
  FRAGMENT_MAIN_BEGIN,
  FRAGMENT_BEFORE_OUTPUT,
  FRAGMENT_MAIN_END,
}
```

## ShaderInjection

```typescript
interface ShaderInjection {
  id: string;
  hook: ShaderHookPoint;
  code: string;
  uniforms?: Record<string, unknown>;
  onUpdate?: (uniforms, deltaTime) => void;
}
```

## TourPlugin

```typescript
interface TourPlugin {
  name: string;
  version: string;
  init?(ctx: TourPluginContext): void;
  update?(ctx: FrameContext): void;
  destroy?(): void;
}
```
