# 渲染器

## 双后端架构

`@3dgs/renderer-three` 提供两个渲染后端：

| 后端 | 类 | 说明 |
|------|-----|------|
| WebGL2 + Spark | `RenderManager` | 默认, 生产就绪 |
| WebGPU 原生 | `WebGPURenderManager` | ⚠️ 实验性, 未验证 |

`createRenderer()` 自动检测 WebGPU 并选择后端，不可用时回退到 WebGL2。

### 创建渲染器

```typescript
import { createRenderer, createRendererSync } from '@3dgs/renderer-three';

// 方式一: 异步创建 (自动检测 WebGPU, 推荐用法)
const { renderer, backend } = await createRenderer();
// backend: 'webgpu' | 'webgl2'

// 方式二: 同步创建 (直接使用 WebGL2)
import { RenderManager } from '@3dgs/renderer-three';
const renderer = new RenderManager({ enableLod: true });

// 方式三: 直接使用 WebGPU (实验性)
import { WebGPURenderManager } from '@3dgs/renderer-three';
const renderer = new WebGPURenderManager();
await renderer.init(); // 必须在 mount 之前调用
```

### 渲染器选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `deviceTier` | `DeviceTier` | 自动检测 | 强制设备分级 |
| `pixelRatio` | `number` | 1.0 | 像素比 |
| `resolutionScale` | `number` | 按设备分级 | 分辨率缩放比 |
| `adaptiveResolution` | `boolean` | `true` | 自适应分辨率 |
| `enableKeyboardControls` | `boolean` | `true` | 键盘漫游 (WASD/QE) |
| `moveSpeed` | `number` | 5.0 | 移动速度 |
| `autoOrient` | `boolean` | `true` | 加载后垂直翻转 |
| `enableLod` | `boolean` | `true` | 构建 LOD 树 |
| `enableGpuSort` | `boolean` | `true` | (WebGPU) GPU compute 排序 |

### 设备分级

| 级别 | 分辨率 | SH | 最大 Splats | blurAmount | minAlpha | 排序间隔 |
|------|--------|----|------------|------------|----------|---------|
| LOW | 0.5x | 0 | 250K | 0.1 | 5/255 | 100ms |
| MEDIUM | 0.75x | 0 | 500K | 0.2 | 2/255 | 50ms |
| HIGH | 1.0x | 1 | 1M | 0.3 | 1/255 | 33ms |
| ULTRA | 1.0x | 2 | 2.5M | 0.3 | 0.5/255 | 16ms |

### 交互方式

| 操作 | 方式 |
|------|------|
| 旋转视角 | 鼠标拖拽 / 单指触摸 |
| 前进后退 | 滚轮 / 双指捏合 |
| 水平移动 | W A S D |
| 升高下降 | Q E |

### SOG 流式加载

```typescript
await renderer.loadScene('/scenes/large.splat', {
  lodSource: '/scenes/large.sog',
  onProgress: (loaded, total) => {
    console.log(`${loaded}/${total} splats loaded`);
  },
  onFirstFrame: () => {
    console.log('首帧已渲染, 可隐藏加载遮罩');
  },
});
```

### 帧回调

```typescript
const unsubscribe = renderer.onFrame((deltaTime: number) => {
  // 每帧调用, 挂载在渲染器的单一 RAF 循环上
});

// 取消注册
unsubscribe();
```
