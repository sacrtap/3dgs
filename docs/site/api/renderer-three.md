# @3dgs/renderer-three

Three.js + Spark / WebGPU 渲染器适配层。

## RenderManager

核心渲染器（WebGL2 + Spark），实现 `RendererAdapter` 接口。

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
| `loadScene(source, options?)` | 加载场景 (支持 .splat/.spz/.sog + SOG 流式) |
| `getViewProjectionMatrix()` | 获取 VP 矩阵 (16 元素) |
| `getCameraPosition()` | 获取相机位置 |
| `getSize()` | 获取视口尺寸 |
| `getDeviceTier()` | 获取设备分级 |
| `setResolutionScale(scale)` | 设置分辨率缩放比 |
| `onFrame(callback)` | 注册帧回调 (返回取消函数) |
| `addShaderInjection(injection)` | 添加 GLSL Shader 注入 |
| `removeShaderInjection(id)` | 移除 Shader 注入 |
| `getDeviceProfile()` | 获取设备详细信息 |
| `getResolutionScale()` | 获取当前分辨率缩放比 |
| `isLodReady()` | LOD 树是否已构建完成 |
| `setKeyboardEnabled(enabled)` | 动态启用/禁用键盘控制 |
| `setMoveSpeed(speed)` | 动态设置移动速度 |
| `setVerticalSpeed(speed)` | 动态设置升降速度 |
| `getActiveMoveKeys()` | 获取当前按下的移动键列表 |
| `setFrustumCulling(enabled)` | 启用/禁用视锥裁剪 |
| `getVisibleSplatCount()` | 获取当前可见 splat 数量 |
| `getSogLodLevels()` | 获取预构建 SOG LOD 层级 |
| `getSogLodBase()` | 获取 LOD 缩减因子 |
| `destroy()` | 销毁，释放所有 GPU 资源 |
| `static isCrossOriginIsolated()` | 检测 `SharedArrayBuffer` 是否可用 |

### ThreeRenderer

`RenderManager` 的别名，向后兼容：

```typescript
import { ThreeRenderer } from '@3dgs/renderer-three';
// ThreeRenderer === RenderManager
```

## WebGPURenderManager

> ⚠️ **@experimental** — 此渲染器尚未经过完整验证，不建议在生产环境使用。

WebGPU 原生 3DGS 渲染器，实现 `RendererAdapter` 接口。使用 WGSL 着色器 + GPU compute shader 排序。

```typescript
import { WebGPURenderManager } from '@3dgs/renderer-three';

const renderer = new WebGPURenderManager({
  deviceTier?: DeviceTier,
  pixelRatio?: number,
  resolutionScale?: number,
  adaptiveResolution?: boolean,
  clearColor?: number,
  enableKeyboardControls?: boolean,
  moveSpeed?: number,
  verticalSpeed?: number,
  autoOrient?: boolean,
  enableGpuSort?: boolean,
  enableLod?: boolean,
});

await renderer.init();   // 初始化 WebGPU 设备 (必须在 mount 之前)
renderer.mount(container);
renderer.start();
await renderer.loadScene('/scene.splat');
```

### WebGPURenderManagerOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `deviceTier` | `DeviceTier` | 自动检测 | 强制设备分级 |
| `pixelRatio` | `number` | 1.0 | 像素比覆盖 |
| `resolutionScale` | `number` | 按设备分级 | 初始分辨率缩放比 |
| `adaptiveResolution` | `boolean` | `true` | 是否启用自适应分辨率 |
| `clearColor` | `number` | `0x111111` | 清除色 |
| `enableKeyboardControls` | `boolean` | `true` | 键盘漫游 (WASD/QE) |
| `moveSpeed` | `number` | 5.0 | 键盘移动速度 |
| `verticalSpeed` | `number` | 3.0 | 键盘升降速度 |
| `autoOrient` | `boolean` | `true` | 加载后垂直翻转 |
| `enableGpuSort` | `boolean` | `true` | 是否启用 GPU compute 排序 |
| `enableLod` | `boolean` | `true` | 是否启用 LOD |

### WebGPURenderManager 额外方法

| 方法 | 说明 |
|------|------|
| `init()` | 初始化 WebGPU 设备 (异步, 必须在 mount/start 之前) |
| `applyCapability(capability)` | 应用 WebGPU 能力检测结果, 自动调整渲染参数 |
| `getSortManager()` | 获取 GPU 排序管理器 |
| `getLastSortResult()` | 获取最后排序结果 |
| `getSogLodLevels()` | 获取预构建 SOG LOD 层级 |
| `getSogLodBase()` | 获取 LOD 缩减因子 |
| `setFrustumCulling(enabled)` | 启用/禁用视锥裁剪 |
| `getVisibleSplatCount()` | 获取当前可见 splat 数量 |

### WGSL 着色器

WebGPURenderManager 内置完整的 EWA Splatting WGSL 着色器：

- **顶点着色器**: 3D 协方差矩阵 → view-space 变换 → 透视 Jacobian → 2D 屏幕协方差 → 低通滤波 → conic (逆协方差) → 特征值 → quad 尺寸
- **片段着色器**: 2D 椭圆高斯衰减 `alpha = opacity * exp(-0.5 * power)`
- **Alpha blending**: 标准 back-to-front `src * alpha + dst * (1 - alpha)`

## createRenderer

异步创建渲染器，自动检测 WebGPU 并选择后端：

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
| `renderer` | `RendererAdapter` | 渲染器实例 (WebGPURenderManager 或 RenderManager) |
| `backend` | `'webgpu' \| 'webgl2'` | 实际使用的后端 |
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
  parallel: true,         // 是否并行加载 (默认 true)
  parallelCount: 4,       // 并行加载数 (默认 4)
  maxSplats: 500_000,     // 最大 splat 数 (提前终止)
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
| `parallel` | `boolean` | 是否并行加载 (默认 true) |
| `parallelCount` | `number` | 并行加载数 (默认 4) |
| `maxSplats` | `number` | 最大 splat 数 — 早期终止加载 |

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
  compression: number;         // 0=none, 1=gzip (SOG v2)
  lodTreeOffset: number;      // LOD 树偏移 (0=无预构建)
  lodTreeSize: number;        // LOD 树大小 (0=无预构建)
  lodQuality: number;         // 0=fast, 1=quality
  positionQuantization: number; // 0=off, 1=24-bit
  version: number;            // 1 或 2
  lodLevels?: number[];       // 预构建 LOD 层级 (累计 splat 数)
  lodBase?: number;           // LOD 缩减因子 (1.5=fast, 1.75=quality)
}
```

## WebGPUSortManager

GPU 距离计算 + CPU 混合排序管理器。可在无 WebGPU 环境下使用 CPU 回退。

```typescript
import { WebGPUSortManager } from '@3dgs/renderer-three';

const sortManager = new WebGPUSortManager({ device });
await sortManager.init();
sortManager.uploadPositions(positions); // Float32Array, 3N

const result = await sortManager.sort(camX, camY, camZ);
// result.indices: 排序后的索引 (远→近)
```

### SortResult

| 字段 | 类型 | 说明 |
|------|------|------|
| `indices` | `Uint32Array` | 排序后的 splat 索引 (远→近) |
| `durationMs` | `number` | 排序耗时 |
| `count` | `number` | splat 数量 |
| `method` | `'gpu-hybrid' \| 'cpu'` | 排序方式 |

## SpatialGrid / FrustumCulling

基于 Morton 空间排序的视锥剔除。

```typescript
import { FrustumCulling } from '@3dgs/renderer-three';

const culling = new FrustumCulling(splatData, bbox);
const ranges = culling.getVisibleRanges(projScreenMatrix);
// ranges = [{ byteOffset, count }, ...]
```

### VisibleRange

| 字段 | 类型 | 说明 |
|------|------|------|
| `byteOffset` | `number` | 在 .splat 数据中的字节偏移 |
| `count` | `number` | splat 数量 |

## SplatBufferPool

ArrayBuffer 对象池，用于场景切换时复用已分配的内存。

```typescript
import { SplatBufferPool } from '@3dgs/renderer-three';

const pool = new SplatBufferPool({ maxPoolSize: 16 });
const buf = pool.acquire(1024 * 1024);
// ... 使用 buf ...
pool.release(buf);
```

## SPZ 解码

```typescript
import { decodeSpzInWorker, decodeSpz, parseSpzHeader, validateSpzHeader } from '@3dgs/renderer-three';

// Worker 解码 (自动回退主线程)
const splatBytes = await decodeSpzInWorker(spzArrayBuffer);

// 主线程解码
const splatBytes = await decodeSpz(spzArrayBuffer);

// Header 解析/验证
const header = parseSpzHeader(spzArrayBuffer);
validateSpzHeader(header);
```

## WGSL Shader 注入工具

WebGPU 路径的 WGSL 代码注入，与 GLSL 注入 API 对称。

```typescript
import { injectWgslAfterMainBegin, injectWgslBeforeMainEnd, injectWgslBeforePattern } from '@3dgs/renderer-three';
```

| 函数 | 说明 |
|------|------|
| `injectWgslAfterMainBegin(shader, fnName, code)` | 在 WGSL 函数 main 开头插入 |
| `injectWgslBeforeMainEnd(shader, fnName, code)` | 在 WGSL 函数末尾插入 |
| `injectWgslBeforePattern(shader, pattern, code)` | 在正则模式前插入 |
| `inferWgslType(value)` | 推断 WGSL 类型 |
| `wgslTypeSize(wgslType)` | 计算 WGSL 类型字节大小 |
| `wgslTypeAlignedSize(wgslType)` | 计算 WGSL 类型对齐大小 |

## WebGPU 检测

```typescript
import { detectWebGPU, isWebGPUMaybeAvailable } from '@3dgs/renderer-three';

const capability = await detectWebGPU();
// { supported: boolean, reason?: string, gpuType?, adapterInfo?, ... }

// 快速同步检测 (不创建 GPU 上下文)
const maybe = isWebGPUMaybeAvailable(); // boolean
```

### WebGPUCapability

| 字段 | 类型 | 说明 |
|------|------|------|
| `supported` | `boolean` | WebGPU 是否可用 |
| `reason` | `string` | 不可用原因 (仅 `supported=false`) |
| `gpuType` | `'discrete' \| 'integrated' \| 'mobile' \| 'software'` | GPU 类型分类 |
| `adapterInfo` | `{ vendor, architecture, description }` | GPU 适配器信息 |
| `webgpuLimits` | `WebGPULimits` | GPU 限制 (maxBufferSize 等) |
| `textureCompression` | `{ bc, etc2, astc }` | 纹理压缩支持 |
| `recommendedMaxSplats` | `number` | 根据 GPU 类型推荐的 maxSplats |
| `recommendedResolutionScale` | `number` | 推荐的分辨率缩放比 |
| `recommendedSortIntervalMs` | `number` | 推荐的排序间隔 |
