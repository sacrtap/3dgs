# TD-31: WebGPU 排序全 GPU 化 — 计数排序方案 (书面方案, 需真实 GPU 闭环)

> 状态: 📄 书面方案 — WGSL compute 需真实 WebGPU 设备验证, 本地 (macOS Intel, 无 WebGPU) 无法闭环
> 日期: 2026-09-13
> 关联: `webgpu-sort-manager.ts` (现状混合 GPU+CPU)、TD-09 (视锥裁剪 visibility mask)、R-03 (WebGPU 转正评估)

## 1. 现状与瓶颈

`WebGPUSortManager.sort()` (webgpu-sort-manager.ts:202-290) 当前流程:

```
Pass 1: GPU compute 算距离 (1 个 compute pass)
  → copyBufferToBuffer → mapAsync 回读到 CPU
  → CPU Uint32Array.sort (全排序, O(N log N))
  → writeBuffer 回写 indexBuffer
```

**两次跨边界传输**: GPU→CPU 回读 4N 字节 + CPU→GPU 回写 4N 字节。
1M splat = 每帧 8 MB 双向传输 + 1M 项 CPU 排序 ≈ 数 ms 级开销。

## 2. 目标设计: 计数排序全 GPU 化 (5-pass, 8bit=256 桶, O(N))

### Pass A — 距离与桶值

- compute: 逐 splat 算 `dist² → bucket = clamp(floor(distNorm * 256), 0, 255)`;
  **保留 CPU 回退** `sortOnCPU` / `sortOnCPUStatic` (无 GPU 设备时)。

### Pass B — 256 桶直方图

- 每 workgroup 局部直方图 (256 项共享内存) + `atomicAdd` 累加到全局桶计数;
- 输出: `histogram[256] u32`。

### Pass C — 前缀和

- 单 workgroup (256 线程) 对 histogram 做独占前缀和 → `bucketOffset[256]`,
  得到每个桶的起始写入位置 (桶内顺序无关, 稳定序由 Pass E 保证)。

### Pass D — 散射

- 逐 splat: `atomicAdd(&counter[bucket])` 取桶内位置 → 写
  `sortedByBucket[offset + pos] = globalIndex`;
- 输出: `sortedByBucket[N] u32` (桶间有序)。

### Pass E — 桶内精排 + visibility 消费

- 桶平均大小 ~N/256; 每桶 1 workgroup, 256 线程对桶内做 bitsort/双调排序
  (目录小于 256 项用共享内存);
- **消费 TD-09 的 visibility mask**: 只写可见 splat → 直写最终 `drawIndices`
  与 `visibleCount`, 渲染 loop 不再依赖 `result.indices` 回读。

## 3. 接口变更

| 变更点 | 现状 | 目标 |
| --- | --- | --- |
| `sort()` 返回 | `{ indices, durationMs, count, method }` | `indices` 改为可选 (不再回读); 保留 `method` |
| `method` 枚举 | `'gpu-hybrid' \| 'cpu'` | 扩展 `'gpu-hybrid' \| 'gpu-native' \| 'cpu'` |
| renderLoop 消费 | `result.indices` | `getIndexBuffer()` + `getVisibleCount()` |
| `init()` requiredLimits | `maxStorageBuffersPerShaderStage: 6` | **6 → 10** (新增直方图/前缀和/散射/排序缓冲) |
| `adjustForGpuLimits` | `bytesPerSplat 64` | ~100 (含 SH 与排序辅助缓冲摊薄) |

## 4. 风险与约束

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| atomicAdd 支持 | 消费级 GPU 的 storage-buffer atomic 为 WGSL 强制功能 (自 WebGPU 1.0) | 真机验证; 不支持则 method 回退 `gpu-hybrid` |
| 稳定性 | 8bit 桶内同距多 splat 顺序 | 桶内 bitsort 保序; 同距渲染无视觉差异 (现状 §2.3 注释同结论) |
| TD-09 依赖 | Pass E 消费 CPU visibility mask (TD-09 未完成前保持 CPU mask 契约) | 先落地 TD-09, 再执行 TD-31; 避免双写竞争 (TD-09 写 mask, TD-31 读 mask) |
| 决策注释锚点 | §2.3 三次迭代记录 (readback 复用、TypedArray 排序、onSubmittedWorkDone 移除) | 保留, 追加 §2.4 全 GPU 化记录 |
| 无 GPU 环境 | 本地 (Intel macOS / CI) 无 WebGPU | 单测走 CPU 回退断言 (mock GPU 设备); WGSL 语法用 `@webgpu/types` 编译期校验 |

## 5. 验收信号 (执行时)

1. 新增 sortManager 单测: mock GPU 设备 (无 GPU 走 CPU 回退断言); 计数排序结果
   与 CPU 排序等价 (同距离稳定序); `method` 字段正确; 现有
   `webgpu-render-manager.test.ts` 全绿。
2. 真机/WebGPU CI (若可用): 1M splat 排序 P50 相比 `gpu-hybrid` 下降 (目标
   消除双向传输, 排序耗时 -50%+);
3. `requiredLimits.maxStorageBuffersPerShaderStage` 提升后 device.requestDevice
   成功 (消费级 GPU 上限 ≥ 10: 该限制典型值 8-12, 需真机核验, 若不足 10 需
   缓冲合并布局降级);
4. `pnpm typecheck` / `pnpm lint` 全绿。

## 6. 结论与判定

- **无法本地闭环**: WGSL compute 管线 (原子直方图/前缀和/散射/bitsort) 的正确性
  与性能只能由真实 WebGPU 设备验证; 本地 Intel macOS + CI 均无 WebGPU。
- **落地前提**: (a) TD-09 先落地 (visibility mask 契约); (b) 拥有 WebGPU 真机或
  WebGPU CI runner; (c) 用户确认投入 (R-03 评估窗口内执行)。
- **当前分支动作**: 不落地代码; 本文档为待执行设计。现状 `gpu-hybrid` 已可工作,
  全 GPU 化为性能优化而非正确性修复, 优先级 P2。