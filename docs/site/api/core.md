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
| `setRenderer(renderer)` | 设置渲染器（在 `load` 前调用） |
| `load(config)` | 加载漫游配置（对象或 URL） |
| `switchScene(sceneId, transition?)` | 切换到指定场景 |
| `use(plugin)` | 注册插件（返回 `this`，可链式调用） |
| `on(event, handler)` | 监听事件（返回取消函数） |
| `emit(event, data?)` | 触发事件（供插件间通信使用） |
| `getSceneManager()` | 获取场景管理器 |
| `getRenderer()` | 获取渲染器 |
| `getContainer()` | 获取 DOM 容器 |
| `isLoaded()` | 是否已加载配置 |
| `destroy()` | 销毁播放器，释放所有资源 |

### 事件

| 事件 | 说明 |
|------|------|
| `load` | 配置加载完成 |
| `scene:switching` | 场景切换开始 |
| `scene:switched` | 场景切换完成 |
| `hotspot:click` | 热点点击 |
| `hotspot:hover` | 热点悬停 |
| `error` | 错误 |

## SceneManager

场景管理器，管理场景注册、加载状态和切换。

```typescript
import { SceneManager } from '@3dgs/core';

const manager = new SceneManager(defaults?);
```

### 方法

| 方法 | 说明 |
|------|------|
| `register(id, config)` | 注册场景 |
| `loadScene(id)` | 加载场景（已加载则跳过） |
| `switchTo(id, transition?)` | 切换到指定场景（自动加载） |
| `preload(id)` | 预加载场景（后台静默加载） |
| `preloadScenes(ids)` | 批量预加载场景 |
| `getCurrent()` | 获取当前场景实例 |
| `get(id)` | 获取指定场景实例 |
| `list()` | 获取所有已注册场景 |
| `getCurrentId()` | 获取当前场景 ID |
| `on(type, handler)` | 监听场景事件 |
| `destroy()` | 销毁，清理资源 |

### SceneInstance

```typescript
interface SceneInstance {
  id: string;
  config: SceneConfig & { defaults?: TourDefaults };
  state: 'unloaded' | 'loading' | 'loaded' | 'error';
  loadError?: string;
}
```

## TourConfig

声明式场景图配置格式。

```typescript
interface TourConfig {
  version: '1.0';
  meta?: TourMeta;
  defaults?: TourDefaults;
  scenes: Record<string, SceneConfig>;
}

interface TourMeta {
  title?: string;
  description?: string;
  author?: string;
  previewImage?: string;
}

interface TourDefaults {
  camera?: CameraSettings;
  transition?: SceneTransition;
  quality?: QualitySettings;
}
```

### SceneConfig

```typescript
interface SceneConfig {
  title?: string;
  source: string;                    // .splat / .spz 文件路径
  lodSource?: string;                // SOG 流式 LOD URL (可选)
  initialView?: {
    yaw: number;
    pitch: number;
    fov: number;
  };
  extensions?: Record<string, unknown>;  // 通用扩展点 (插件配置)
  overrides?: {
    camera?: Partial<CameraSettings>;
    quality?: Partial<QualitySettings>;
  };
  info?: {
    description?: string;
    tags?: string[];
    thumbnail?: string;
  };
}
```

### CameraSettings

```typescript
interface CameraSettings {
  fov: number;
  minFov: number;
  maxFov: number;
  limitPitch: [number, number];
}
```

### QualitySettings

```typescript
interface QualitySettings {
  maxSplats: number;
  shDegree: number;
  resolution: number;       // 渲染缩放比 0.5-1.0
  antialias: boolean;
  pixelRatio: number;
}
```

### SceneTransition

```typescript
interface SceneTransition {
  type: 'fade' | 'fly' | 'instant';
  duration?: number;
  targetYaw?: number;
  targetPitch?: number;
  targetFov?: number;
}
```

详见 [配置参考](/guide/configuration)。

## TourLoader

配置加载器，支持从 URL 或对象加载 TourConfig。

```typescript
import { TourLoader } from '@3dgs/core';

const loader = new TourLoader();

// 从 URL 加载
const runtime = await loader.load('https://example.com/tour.json');

// 从对象加载
const runtime = loader.fromObject(configObject);

// 取消加载
loader.abort();

// 清除缓存
loader.clearCache();
```

### TourRuntime

```typescript
interface TourRuntime {
  meta?: TourMeta;
  defaults?: TourDefaults;
  sceneManager: SceneManager;
  currentScene: string | null;
}
```

## RendererAdapter

渲染器抽象接口，将核心层与具体渲染后端解耦。

### 方法

| 方法 | 说明 |
|------|------|
| `mount(container)` | 挂载到 DOM |
| `start()` | 开始渲染 |
| `stop()` | 停止渲染循环 |
| `loadScene(source, options?)` | 加载场景 |
| `getViewProjectionMatrix()` | 获取 VP 矩阵 (16 元素) |
| `getCameraPosition()` | 获取相机位置 |
| `getSize()` | 获取视口尺寸 |
| `getDeviceTier()` | 获取设备分级 |
| `setResolutionScale(scale)` | 设置分辨率缩放比 |
| `onFrame(callback)` | 注册帧回调 (返回取消函数) |
| `addShaderInjection(injection)` | 添加 Shader 注入 |
| `removeShaderInjection(id)` | 移除 Shader 注入 |
| `destroy()` | 销毁，释放 GPU 资源 |

### LoadOptions

```typescript
interface LoadOptions {
  onProgress?: (loaded: number, total: number) => void;
  shDegree?: number;
  maxSplats?: number;
  lodSource?: string;  // SOG 流式 LOD URL
}
```

## DeviceTier

```typescript
enum DeviceTier {
  LOW,     // 250K splats, 0.5x 分辨率
  MEDIUM,  // 500K splats, 0.75x 分辨率
  HIGH,    // 1M splats, 1.0x 分辨率
  ULTRA,   // 2M+ splats, 1.0x 分辨率
}
```

## ShaderHookPoint

```typescript
enum ShaderHookPoint {
  VERTEX_MAIN_BEGIN,        // 顶点着色器 main() 开头
  VERTEX_BEFORE_POSITION,   // gl_Position 赋值前
  VERTEX_MAIN_END,          // 顶点着色器 main() 结尾
  FRAGMENT_MAIN_BEGIN,      // 片段着色器 main() 开头
  FRAGMENT_BEFORE_OUTPUT,   // 最终输出前
  FRAGMENT_MAIN_END,        // 片段着色器 main() 结尾
}
```

## ShaderInjection

```typescript
interface ShaderInjection {
  id: string;
  hook: ShaderHookPoint;
  code: string;
  uniforms?: Record<string, unknown>;
  onUpdate?: (uniforms: Record<string, unknown>, deltaTime: number) => void;
}
```

详见 [Shader 注入指南](/guide/shader-injection)。

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

### TourPluginContext

插件初始化时获得的上下文：

```typescript
interface TourPluginContext {
  player: TourPlayer;
  sceneManager?: SceneManager;
  renderer?: RendererAdapter;
  container: HTMLElement;
}
```

### FrameContext

每帧更新时获得的数据：

```typescript
interface FrameContext {
  camera: { x: number; y: number; z: number };
  vpMatrix: Float32Array;
  size: { width: number; height: number };
  sceneManager?: SceneManager;
  deltaTime: number;  // 帧间隔 (ms)
}
```

详见 [插件开发指南](/guide/plugin-dev)。

## PluginSystem

插件系统，管理插件注册、更新和销毁。通常通过 `TourPlayer.use()` 间接使用。

| 方法 | 说明 |
|------|------|
| `register(plugin, player)` | 注册插件并调用 `init` |
| `update(deltaTime, frameData)` | 每帧更新所有插件 |
| `destroyAll()` | 销毁所有插件 |
| `list()` | 获取已注册插件列表 (只读) |
