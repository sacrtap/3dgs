# @3dgs/renderer-three

Three.js + Spark 渲染器适配层。

## RenderManager

核心渲染器，实现 `RendererAdapter` 接口。

```typescript
import { RenderManager } from '@3dgs/renderer-three';

const renderer = new RenderManager({
  deviceTier?: DeviceTier,
  pixelRatio?: number,
  resolutionScale?: number,
  adaptiveResolution?: boolean,
  clearColor?: number,
  enableKeyboardControls?: boolean,
  moveSpeed?: number,
  verticalSpeed?: number,
  autoOrient?: boolean,
  enableLod?: boolean,
});
```

### RenderManagerOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `deviceTier` | `DeviceTier` | 自动检测 | 强制设备分级 |
| `pixelRatio` | `number` | 1.0 | 像素比覆盖 |
| `resolutionScale` | `number` | 按设备分级 | 初始分辨率缩放比 |
| `adaptiveResolution` | `boolean` | `true` | 是否启用自适应分辨率 |
| `clearColor` | `number` | `0x111111` | 清除色 |
| `enableKeyboardControls` | `boolean` | `true` | 键盘漫游 (WASD/QE) |
| `moveSpeed` | `number` | 5.0 | 键盘移动速度 (单位/秒) |
| `verticalSpeed` | `number` | 3.0 | 键盘升降速度 (单位/秒) |
| `autoOrient` | `boolean` | `true` | 加载后垂直翻转 (Y-down → Y-up) |
| `enableLod` | `boolean` | `true` | 加载后构建 LOD 树 |

### RenderManager 方法

| 方法 / 属性 | 说明 |
|------------|------|
| `mount(container)` | 挂载到 DOM |
| `start()` | 开始渲染 (单一 RAF 循环) |
| `stop()` | 停止渲染循环 |
| `loadScene(source, options?)` | 加载场景 (支持 SOG 流式) |
| `getViewProjectionMatrix()` | 获取 VP 矩阵 (16 元素) |
| `getCameraPosition()` | 获取相机位置 |
| `getSize()` | 获取视口尺寸 |
| `getDeviceTier()` | 获取设备分级 |
| `setResolutionScale(scale)` | 设置分辨率缩放比 |
| `onFrame(callback)` | 注册帧回调 (返回取消函数) |
| `addShaderInjection(injection)` | 添加 Shader 注入 |
| `removeShaderInjection(id)` | 移除 Shader 注入 |
| `getDeviceProfile()` | 获取设备详细信息 |
| `getResolutionScale()` | 获取当前分辨率缩放比 |
| `isLodReady()` | LOD 树是否已构建完成 |
| `setKeyboardEnabled(enabled)` | 动态启用/禁用键盘控制 |
| `setMoveSpeed(speed)` | 动态设置移动速度 |
| `setVerticalSpeed(speed)` | 动态设置升降速度 |
| `getActiveMoveKeys()` | 获取当前按下的移动键列表 |
| `destroy()` | 销毁，释放所有 GPU 资源 |
| `static isCrossOriginIsolated()` | 检测 `SharedArrayBuffer` 是否可用 |

### ThreeRenderer

`RenderManager` 的别名，向后兼容：

```typescript
import { ThreeRenderer } from '@3dgs/renderer-three';
// ThreeRenderer === RenderManager
```

## createRenderer

异步创建渲染器，自动检测 WebGPU：

```typescript
import { createRenderer } from '@3dgs/renderer-three';

const { renderer, backend, webgpuCapability } = await createRenderer({
  preferredBackend: 'webgpu',  // 'webgpu' | 'webgl2' (默认 'webgpu')
  forceBackend: false,         // 是否强制指定后端 (不回退)
  // ...其余 RenderManagerOptions
});
```

### CreateRendererOptions

继承 `RenderManagerOptions`，额外包含：

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `preferredBackend` | `'webgpu' \| 'webgl2'` | `'webgpu'` | 偏好后端 |
| `forceBackend` | `boolean` | `false` | 是否强制指定后端 (不回退) |

### CreateRendererResult

| 字段 | 类型 | 说明 |
|------|------|------|
| `renderer` | `RendererAdapter` | 渲染器实例 |
| `backend` | `RendererBackend` | 实际使用的后端 |
| `webgpuCapability` | `WebGPUCapability` | WebGPU 检测结果 |

## createRendererSync

同步创建渲染器（直接使用 WebGL2，不等待 WebGPU 检测）：

```typescript
import { createRendererSync } from '@3dgs/renderer-three';

const renderer = createRendererSync();
```

## SogStreamer

SOG 流式加载器，支持分块渐进式加载。

```typescript
import { SogStreamer } from '@3dgs/renderer-three';

const streamer = new SogStreamer({
  url: '/scenes/large.sog',
  onProgress: (loadedChunks, totalChunks, loadedSplats, totalSplats) => {},
  onChunkLoaded: (index, data, count) => {},
  onComplete: () => {},
  onError: (error) => {},
  parallel: false,  // 是否并行加载 (默认 false)
});

const metadata = await streamer.start();
streamer.abort();
```

### SogStreamerOptions

| 选项 | 类型 | 说明 |
|------|------|------|
| `url` | `string` | SOG 文件 URL |
| `onProgress` | `(loadedChunks, totalChunks, loadedSplats, totalSplats) => void` | 加载进度回调 |
| `onChunkLoaded` | `(index, data, count) => void` | chunk 加载完成回调 |
| `onComplete` | `() => void` | 所有 chunk 加载完成回调 |
| `onError` | `(error: Error) => void` | 错误回调 |
| `parallel` | `boolean` | 是否并行加载 (默认 false) |

### SogMetadata

```typescript
interface SogMetadata {
  numSplats: number;
  numChunks: number;
  chunkSize: number;
  shDegree: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  chunks: SogChunkEntry[];
}
```

## WebGPU 检测

```typescript
import { detectWebGPU, isWebGPUMaybeAvailable } from '@3dgs/renderer-three';

const capability = await detectWebGPU();
// { supported: boolean, reason?: string, adapterInfo?: { vendor, architecture, description } }

// 快速同步检测 (不创建 GPU 上下文)
const maybe = isWebGPUMaybeAvailable(); // boolean
```

### WebGPUCapability

| 字段 | 类型 | 说明 |
|------|------|------|
| `supported` | `boolean` | WebGPU 是否可用 |
| `adapterInfo` | `{ vendor, architecture, description }` | GPU 适配器信息 (仅 supported 时) |
| `reason` | `string` | 不可用原因 (仅 supported=false 时) |
