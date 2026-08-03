# 性能优化

## COOP/COEP 跨域隔离

3DGS 渲染依赖 `SharedArrayBuffer`（Spark 的 WASM Worker 排序），必须配置跨域隔离头。

### 检测

```typescript
import { RenderManager } from '@3dgs/renderer-three';

if (RenderManager.isCrossOriginIsolated()) {
  console.log('✓ SharedArrayBuffer 可用');
} else {
  console.warn('✗ SharedArrayBuffer 不可用, 排序性能将退化 10-30x');
}
```

### 配置

详见 [部署指南](/guide/deployment)。

## 设备分级

引擎自动检测设备能力并选择渲染参数：

```typescript
const tier = renderer.getDeviceTier();
// DeviceTier.LOW / MEDIUM / HIGH / ULTRA
```

| 级别 | 分辨率 | SH | 最大 Splats |
|------|--------|----|------------|
| LOW | 0.5x | 0 | 250K |
| MEDIUM | 0.75x | 0 | 500K |
| HIGH | 1.0x | 1 | 1M |
| ULTRA | 1.0x | 2 | 2.5M |

## 自适应分辨率

帧率低于阈值时自动降分辨率：

```typescript
// 默认启用, 可手动控制
renderer.setResolutionScale(0.75); // 强制 75% 分辨率
```

## 性能优化清单

1. **antialias: false** — WebGL MSAA 对 3DGS 无效且严重降帧
2. **setPixelRatio(1.0)** — 不跟随 devicePixelRatio
3. **单一 RAF 循环** — 通过 onFrame() 挂载, 杜绝双 RAF
4. **LOD 树** — 加载后调用 createLodSplats() 构建层级
5. **SOG 流式加载** — 首帧快速渲染, 渐进补全
6. **深度遮挡降频采样** — 每 2-3 帧一次, 不阻塞主线程
7. **连续指数平滑** — 帧率无关的相机移动, 无量化跳变
8. **自适应分辨率** — 低帧率时自动降分辨率
9. **设备分级** — 根据硬件能力选择渲染参数

## 性能基准

详见 [性能基准报告](https://github.com/sacrtap/3dgs/blob/main/docs/05-性能基准报告.md)。
