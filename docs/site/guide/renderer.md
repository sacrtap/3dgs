# 渲染器

## RenderManager

`@3dgs/renderer-three` 提供基于 Three.js + Spark 的 3DGS 渲染实现。

### 创建渲染器

```typescript
import { createRenderer, createRendererSync } from '@3dgs/renderer-three';

// 方式一: 异步创建 (自动检测 WebGPU)
const { renderer, backend } = await createRenderer();

// 方式二: 同步创建 (直接使用 WebGL2)
import { RenderManager } from '@3dgs/renderer-three';
const renderer = new RenderManager({ enableLod: true });
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

### 设备分级

| 级别 | 分辨率 | SH | 最大 Splats | 适用设备 |
|------|--------|----|------------|---------|
| LOW | 0.5x | 0 | 250K | 旧手机 |
| MEDIUM | 0.75x | 0 | 500K | 中端手机 |
| HIGH | 1.0x | 1 | 1M | 高端手机/低端PC |
| ULTRA | 1.0x | 2 | 2.5M | 高端PC |

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
