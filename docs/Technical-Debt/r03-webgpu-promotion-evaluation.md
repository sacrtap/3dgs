# R-03: WebGPU 自研 WGSL vs three 官方 WebGPURenderer 评估框架 (书面方案)

> 状态: 📄 书面方案 — 需 WebGPU 真机/基准环境评估, 本地无 GPU 无法闭环
> 日期: 2026-09-13
> 关联: `webgpu-render-manager.ts` (自研 WGSL 路径)、TD-31 (GPU 排序)、C-08 (Worker/WASM)

## 1. 背景

`packages/renderer-three` 维护两条渲染路径:

- **WebGL2 (Spark)**: 生产主路径, Spark 直吃 SPLAT/SPZ 字节;
- **WebGPU (自研 WGSL)**: 实验路径, `webgpu-render-manager.ts` + `webgpu-sort-manager.ts`
  自研 compute/render 管线 (~600+ 行 WGSL), 带 SH 保留 (TD-01)、GPU 排序 (TD-31 待办)。

three.js 官方 `WebGPURenderer` (r167+ 成熟, TSL 着色语言) 是替代/对照项。
本文件定义**评估框架**, 不预设结论。

## 2. 对比维度与评估方法

### 2.1 性能

| 维度 | 自研 WGSL | three WebGPURenderer (TSL) | 评估方法 |
| --- | --- | --- | --- |
| 渲染吞吐 | 定制 splat 渲染 shader, 无抽象层 | TSL 编译开销 + 通用渲染路径 | 同一基准场景, 帧时间分布 (P50/P95) |
| 排序开销 | 混合 GPU+CPU (TD-31 后可全 GPU) | 无内建 3DGS 排序, 需自接 | sort() 耗时对比 (1M splat) |
| 内存 | 仅 splat buffer | 需桥接 three 场景对象 | GPU 内存占用快照 |

**关键事实**: three WebGPURenderer 无内建 3DGS splat 渲染管线 — 两者都需自写
顶点/片元 shader (TSL 或 WGSL)。差异在抽象层成本, 不是"官方开箱即用"。

### 2.2 画质

- SH degree 1-3 支持: 自研 WGSL 已实现 (TD-01); three 侧需自写 SH 求值 TSL 节点。
- 排序正确性: back-to-front 依赖排序; 自研有 CPU 回退; three 侧无现成排序。
- 混合/透明度、LOD、SOG 流式: 均为自研逻辑, 与后端无关。

### 2.3 维护成本

| 项 | 自研 WGSL | three WebGPURenderer |
| --- | --- | --- |
| 代码量 | ~600 行 WGSL + 管理逻辑 | 管理逻辑复用 three 生态 |
| 依赖风险 | 无 (自包含) | three 版本升级 (R-01 已计划) + TSL API 变更 |
| 功能覆盖 | 定制精确 | 通用, 但 3DGS 特性需自补 |
| 调试 | WGSL 编译错误定位 | TSL 抽象层 + 生成代码 |

### 2.4 迁移路径 (若评估通过)

```
当前: WebGPU 实验路径 (自研 WGSL)
  │
  ├─ 路径 A: 继续自研 — TD-31 排序、WGSL 模块化、requiredLimits 调优
  │
  └─ 路径 B: 迁移 three WebGPURenderer
       1. 用 TSL 重写 splat render node (SH 求值 + 排序回退)
       2. 排序管理器复用 (compute pass 可迁到 TSL 或保留原生 WGSL module)
       3. 灰度: 特征开关 `renderer: 'webgpu-three'` 与自研并存一个版本
       4. 双实现对比基准后删除劣势方
```

## 3. 统计指标 (评估期采集)

复用 R-06 的 `RenderStats` 接口 + 扩展:

| 指标 | 说明 |
| --- | --- |
| `fps` / `frameTimeMs` | 帧率与平滑帧时间 |
| `visibleSplats` | 视锥裁剪后可见数 |
| `sortDurationMs` | 排序耗时 (R-03 评估排序路径) |
| `shaderCompileMs` | 首次管线编译耗时 (WGSL vs TSL 差异显著项) |
| `gpuMemMB` | GPU 内存占用 (需设备 API 或浏览器性能面板) |

## 4. 结论与建议

1. **当前阶段保持自研 WGSL 为主实验路径**: three WebGPURenderer 无 3DGS 内建能力,
   迁移成本大于自研增量, 且 R-01 (three 升级) 已带来版本变动风险, 不宜叠加。
2. **评估触发器**: 当 three 官方出现 (a) 内建/官方示例 3DGS 管线, 或 (b) TSL
   compute 能力稳定覆盖排序需求, 再启动 2.4 路径 B 的正式对比。
3. **过渡动作 (低成本, 可随时做)**: 在 WGSL module 层保持"shader 即数据"
   (`wgsl/splat-render-shader.ts` 已独立), 使未来迁移时 shader 可被 TSL 等价物替换,
   渲染管理逻辑复用。
