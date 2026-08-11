# 性能优化

## COOP/COEP 跨域隔离

3DGS 渲染依赖 `SharedArrayBuffer`（Spark 的 WASM Worker 排序），必须配置跨域隔离头。

### 检测

```typescript
import { RenderManager } from '@3dgs/renderer-three';

if (RenderManager.isCrossOriginIsolated()) {
  console.log('✓ SharedArrayBuffer 可用');
} else {
  console.warn('✗ SharedArrayBuffer 不可用, 排序性能将退化');
}
```

### 配置

```yaml
# vite.config.js (开发环境)
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  },
}

# Nginx (生产环境)
add_header Cross-Origin-Opener-Policy "same-origin";
add_header Cross-Origin-Embedder-Policy "require-corp";
add_header Cross-Origin-Resource-Policy "cross-origin";
```

详见 [部署指南](/guide/deployment)。

## 设备分级

引擎自动检测设备能力并选择渲染参数：

```typescript
const tier = renderer.getDeviceTier();
// DeviceTier.LOW / MEDIUM / HIGH / ULTRA
```

| 级别 | 分辨率 | SH | 最大 Splats | LOD 缩放 | 视锥裁剪 |
|------|--------|----|------------|---------|---------|
| LOW | 0.5x | 0 | 250K | 0.3x | 1.0 (紧裁) |
| MEDIUM | 0.75x | 0 | 500K | 0.5x | 1.1 |
| HIGH | 1.0x | 1 | 1M | 1.0x | 1.2 |
| ULTRA | 1.0x | 2 | 2.5M | 1.5x | 1.4 (宽裁) |

## 自适应分辨率

帧率低于阈值时自动降分辨率（默认 `minFps=28`, `targetFps=45`）：

```typescript
// 默认启用, 可手动控制
renderer.setResolutionScale(0.75); // 强制 75% 分辨率
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `minFps` | 28 | 低于此值时降低分辨率 |
| `targetFps` | 45 | 高于此值时尝试恢复分辨率 |
| `minScale` | 0.35 | 最低分辨率缩放比 |
| `adjustInterval` | 45 帧 | 调整间隔 (≈0.75 秒) |

## Splat 数量限制

引擎根据设备分级的 `maxSplats` 参数自动限制加载的 splat 数量，防止低端设备 OOM 和严重降帧：

```typescript
// SplatMesh 构造时传入 maxSplats
new SplatMesh({ url: source, maxSplats: tierSettings.maxSplats });
```

| 设备 | maxSplats | demo2 (2.2M) 裁剪率 |
|------|----------|-------------------|
| LOW | 250K | 88% |
| MEDIUM | 500K | 77% |
| HIGH | 1M | 54% |
| ULTRA | 2.5M | 0% (不裁剪) |

## LOD 质量分级

根据设备分级传入不同的 LOD 参数：

```typescript
// SparkRenderer 配置
new SparkRenderer({
  renderer,
  enableLod: true,
  lodSplatScale: tierSettings.lodSplatScale,
  lodRenderScale: tierSettings.lodRenderScale,
  maxStdDev: tierSettings.maxStdDev,
  minPixelRadius: tierSettings.minPixelRadius,
  clipXY: tierSettings.clipXY,
});

// LOD 树构建
mesh.createLodSplats({ quality: tierSettings.lodQuality });
```

| 设备 | lodSplatScale | lodRenderScale | maxStdDev | clipXY | quality |
|------|-------------|---------------|-----------|--------|---------|
| LOW | 0.3 | 3.0 | √4 | 1.0 | false |
| MEDIUM | 0.5 | 2.0 | √6 | 1.1 | false |
| HIGH | 1.0 | 1.0 | √8 | 1.2 | true |
| ULTRA | 1.5 | 1.0 | √8 | 1.4 | true |

## 排序节流

`minSortIntervalMs` 按设备分级降低排序频率，减少 GPU 排序开销：

| 设备 | minSortIntervalMs | 排序频率 | 适用场景 |
|------|-------------------|---------|---------|
| LOW | 100ms | ~10fps | 低端设备, 排序开销大 |
| MEDIUM | 50ms | ~20fps | 中端设备 |
| HIGH | 33ms | ~30fps | 高端设备 |
| ULTRA | 16ms | ~60fps | 高端 PC, 每帧排序 |

## 注视点渲染

根据设备分级配置中心区域全分辨率、边缘降分辨率的注视点渲染参数：

| 设备 | coneFov0 | coneFov | coneFoveate | behindFoveate |
|------|----------|---------|-------------|---------------|
| LOW | 60° | 90° | 0.3 | 0.1 |
| MEDIUM | 70° | 100° | 0.35 | 0.15 |
| HIGH | 80° | 110° | 0.4 | 0.2 |
| ULTRA | 90° | 120° | 0.4 | 0.2 |

- `coneFov0` — 中心全分辨率锥角
- `coneFov` — 边缘降分辨率锥角
- `coneFoveate` — 边缘分辨率缩放 (0-1)
- `behindFoveate` — 背后分辨率缩放 (0-1)

## 质量参数 (blurAmount / minAlpha / focalAdjustment)

Spark 渲染器内置的 3DGS 质量参数，按设备分级配置：

### blurAmount — 抗锯齿模糊

向 splat 协方差对角线添加标量值，实现模糊+放大，是 MSAA 的低成本替代（我们已关闭 MSAA）。

| 设备 | blurAmount | 说明 |
|------|------------|------|
| LOW | 0.1 | 减少模糊, 降低 overdraw |
| MEDIUM | 0.2 | 平衡 |
| HIGH / ULTRA | 0.3 | Spark 默认, 最佳质量 |

### minAlpha — 最小 alpha 渲染阈值

低于此值的透明 splat 被跳过 (discard)，减少 overdraw。

| 设备 | minAlpha | 说明 |
|------|----------|------|
| LOW | 5/255 ≈ 0.020 | 激进裁剪 |
| MEDIUM | 2/255 ≈ 0.008 | 中等裁剪 |
| HIGH | 1/255 ≈ 0.004 | 轻微裁剪 |
| ULTRA | 0.5/255 ≈ 0.002 | Spark 默认, 几乎不裁剪 |

### focalAdjustment — 投影缩放校正值

控制 splat 渲染锐利度，越大越锐利。

| 设备 | focalAdjustment | 说明 |
|------|-----------------|------|
| LOW / MEDIUM | 1.0 | Spark 默认 |
| HIGH | 1.5 | 中等锐化 |
| ULTRA | 2.0 | 匹配 PlayCanvas, 最锐利 |

## 视锥裁剪

### Spark 内置 clipXY

Spark 内置 `clipXY` 视锥裁剪，控制 splat 中心的 X/Y 裁剪边界：

- `1.0` — 紧裁：中心超出视锥即裁剪 (适合低端设备)
- `1.4` — 宽裁：允许 40% 超出边界 (默认, 适合高端设备)

### Morton 空间分块裁剪 (FrustumCulling)

基于 SOG 的 Morton 排序数据，实现空间分块视锥剔除：

- 8×8×8 = 512 个空间分块
- 每个分块记录包含的 splat 范围 (Morton 排序后空间连续)
- 每帧计算各分块包围盒是否在视锥内
- 仅返回视锥内分块的 splat 范围

```typescript
import { FrustumCulling } from '@3dgs/renderer-three';

const culling = new FrustumCulling(splatData, bbox);
const visibleCount = culling.getVisibleSplatCount(projScreenMatrix);
```

## SOG 流式加载优化

### 临时 Mesh 跳过 LOD

SOG 首块到达时创建临时 Mesh 渲染首帧，全量数据到达后替换。临时 Mesh **不构建 LOD 树**，避免浪费 O(M log M) 计算。

### Web Worker Buffer 拼接

SOG 全量 buffer 拼接在 Web Worker 中执行，避免大文件 (如 67MB) 阻塞主线程：

```typescript
// 在 Worker 中拼接 chunks, 通过 Transferable 传输
const fullBuffer = await concatChunksInWorker(chunkDataList);
```

## WebGPU 渲染 (实验性)

### GPU Compute 排序

`WebGPUSortManager` 使用 WebGPU compute shader 并行计算 splat → 相机距离，然后 CPU 排序：

- GPU 距离计算: ~0.1ms (1M splats)
- CPU 排序: ~1-2ms (1M splats)
- 无需 SharedArrayBuffer，无需 Web Worker 通信开销

### EWA Splatting 着色器

WebGPU 路径使用完整的 EWA splatting WGSL 着色器：

- 3D 协方差矩阵构建 (scale + rotation)
- view-space 协方差变换
- 透视投影 Jacobian
- 2D 屏幕协方差 + 低通滤波
- 椭圆高斯衰减 (conic 矩阵)

## 性能优化清单

### P0 优化 (已实施)

1. **antialias: false** — WebGL MSAA 对 3DGS 无效且严重降帧
2. **setPixelRatio(1.0)** — 不跟随 devicePixelRatio
3. **单一 RAF 循环** — 通过 onFrame() 挂载, 杜绝双 RAF
4. **Splat 数量限制** — `maxSplats` 按设备分级裁剪 splat 数量
5. **LOD 质量分级** — `lodSplatScale` / `lodRenderScale` / `quality` 按设备分级
6. **自适应分辨率** — `minFps=28`, 更早触发降级
7. **高斯核裁剪** — `maxStdDev` 控制 overdraw
8. **最小像素半径** — `minPixelRadius` 跳过过小 splat

### P1 优化 (已实施)

9. **COOP/COEP** — 跨域隔离, 排序移至 Web Worker
10. **SOG 临时 Mesh 跳过 LOD** — 避免重复 LOD 构建
11. **SOG Worker 拼接** — 大 buffer 拼接不阻塞主线程
12. **深度遮挡降频采样** — 每 2-3 帧一次, 不阻塞主线程
13. **连续指数平滑** — 帧率无关的相机移动, 无量化跳变

### P2 优化 (已实施)

14. **视锥裁剪** — `clipXY` 按设备分级配置 + `FrustumCulling` 空间分块
15. **LOD 树** — 加载后调用 createLodSplats() 构建层级
16. **SOG 流式加载** — 首帧快速渲染, 渐进补全
17. **排序节流** — `minSortIntervalMs` 按设备分级降低排序频率
18. **注视点渲染** — `coneFov0`/`coneFov`/`coneFoveate`/`behindFoveate`
19. **blurAmount/minAlpha/focalAdjustment** — 质量参数按设备分级
20. **SplatBufferPool** — ArrayBuffer 对象池, 场景切换复用内存
