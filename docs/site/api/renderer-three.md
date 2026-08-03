# @3dgs/renderer-three

Three.js + Spark 渲染器适配层。

## 导出

### RenderManager

```typescript
import { RenderManager } from '@3dgs/renderer-three';

const renderer = new RenderManager({
  deviceTier?: DeviceTier,
  pixelRatio?: number,
  resolutionScale?: number,
  adaptiveResolution?: boolean,
  enableKeyboardControls?: boolean,
  moveSpeed?: number,
  autoOrient?: boolean,
  enableLod?: boolean,
});
```

### createRenderer

异步创建渲染器，自动检测 WebGPU：

```typescript
import { createRenderer } from '@3dgs/renderer-three';

const { renderer, backend, webgpuCapability } = await createRenderer({
  preferredBackend: 'webgpu', // 'webgpu' | 'webgl2'
});
// backend: 'webgpu' | 'webgl2'
```

### createRendererSync

同步创建渲染器（直接使用 WebGL2）：

```typescript
import { createRendererSync } from '@3dgs/renderer-three';

const renderer = createRendererSync();
```

### SogStreamer

SOG 流式加载器：

```typescript
import { SogStreamer } from '@3dgs/renderer-three';

const streamer = new SogStreamer({
  url: '/scenes/large.sog',
  onProgress: (loadedChunks, totalChunks, loadedSplats, totalSplats) => {},
  onChunkLoaded: (index, data, count) => {},
  onError: (error) => {},
});

await streamer.start();
streamer.abort();
```

### WebGPU 检测

```typescript
import { detectWebGPU, isWebGPUMaybeAvailable } from '@3dgs/renderer-three';

const capability = await detectWebGPU();
// { supported: boolean, reason?: string, adapterInfo?: { vendor, architecture } }
```
