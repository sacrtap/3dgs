# R-09: 移动端真机性能基线方案 (书面方案, 需真机执行)

> 状态: 📄 书面方案 — 采集需真机设备池 (关联 TD-34)
> 日期: 2026-09-13
> 关联: R-06 (RenderStats)、TD-09 (视锥裁剪)、C-07 (--max-splats)、TD-15 (quickselect)、benchmarks/benchmark.ts (R-07)

## 1. 目标

为移动端定义**可复现的性能基线**: 指标、采集方法、阈值, 使优化项 (TD-09 裁剪、
TD-15 quickselect、C-07 预裁剪) 的效果在真机上可量化对比。

## 2. 指标定义

复用 R-06 的 `RenderStats` + 补充:

| 指标 | 来源 | 单位 | 说明 |
| --- | --- | --- | --- |
| FPS P50 / P95 | `RenderStats.fps` 采样 | fps | 帧率分位数 (P50 代表稳态, P95 代表卡顿风险) |
| `frameTimeMs` P50 / P95 | `RenderStats.frameTimeMs` | ms | 帧时间 (与 FPS 互补, 反映单帧毛刺) |
| `visibleSplats` | `RenderStats.visibleSplats` | 个 | 裁剪后可见数 — 验证 TD-09 是否命中预期 |
| 排序耗时 | `sortDurationMs` (R-03 扩展) | ms | 每帧排序开销 (混合 GPU+CPU 路径) |
| 加载耗时 | CLI/loader 计时 | ms | 首帧时间 (WiFi), 关联 C-03 流式 |
| 峰值内存 | `performance.memory` (Chrome) / Instruments | MB | 大场景 OOM 风险 |

## 3. 场景与设备档位

| 档位 | 设备示例 (对齐 TD-34 矩阵) | 场景 splat 数预算 |
| --- | --- | --- |
| 旗舰 | iPhone 15 Pro / Galaxy S24 | 1M (全量) |
| 中端 | iPhone 12 / Pixel 7 | 500K (LOD 或 --max-splats 裁剪) |
| 低端 | Redmi Note 系列 | 200K (强制裁剪) |

基准场景: 固定使用 benchmark 场景 (Garden 级, 与 R-07 benchmarks 脚本同源) —
`benchmarks/benchmark.ts` 已有 FPS 采集, 真机复用同一脚本 + 设备档位参数。

## 4. 采集流程

1. **预热**: 加载场景后空闲 3s (JIT/管线编译稳定);
2. **固定路径**: 播放预设相机路径 60s, 每帧记录 `RenderStats` 快照;
3. **重复**: 同设备重复 3 次, 取中位数 (排除热节流/网络抖动);
4. **记录**: 输出 JSON: `{ device, tier, scene, splatCount, fps: {p50, p95}, frameTimeMs: {p50, p95}, visibleSplats, sortDurationMs, loadMs, peakMemMB }`。

## 5. 阈值建议 (初版, 真机校准后调整)

| 档位 | P50 FPS | P95 FPS | 峰值内存 | 首帧 (WiFi) |
| --- | --- | --- | --- | --- |
| 旗舰 | ≥ 45 | ≥ 30 | ≤ 1.5 GB | ≤ 3 s |
| 中端 | ≥ 30 | ≥ 20 | ≤ 1.2 GB | ≤ 5 s |
| 低端 | ≥ 20 | ≥ 12 | ≤ 1 GB | ≤ 8 s |

**说明**: 初版阈值基于 3DGS 移动端实践 (社区参考值), 需真机数据校准 —
达标判定以首轮采集分布为准, 阈值不达标先修基线场景与设备档位定义, 不急于放宽。

## 6. 与既有门禁的关系

- **R-07 (benchmarks/benchmark.ts)**: 桌面/CI 门禁用 (Garden P50 ≥ 30 FPS);
  R-09 是真机扩展, 两者不冲突 — R-07 守护"没变慢", R-09 守护"移动端可用"。
- **优化项挂钩**: TD-09 (裁剪) 生效指标 = `visibleSplats` 下降而 FPS 不降;
  TD-15/C-07 (预裁剪) 生效指标 = splat 数减少且 P95 改善。

## 7. 落地步骤 (真机资源就绪后)

1. 在 benchmark 脚本增加 `--device-tier` 参数 (复用现有场景与采集循环);
2. 输出 JSON 报告到 `benchmarks/reports/` (gitignored);
3. 阈值断言脚本 (`benchmarks/assert-mobile.mjs`) 按 §5 阈值判定, 供 CI 手动 job 调用;
4. 真机批次执行 (TD-34 §6), 回填校准阈值。

## 8. 结论

本方案定义指标/流程/初版阈值, 真机执行前不落地代码; 已与 R-07/R-06/TD-09 的
数据接口对齐, 真机就绪即可低成本接入。