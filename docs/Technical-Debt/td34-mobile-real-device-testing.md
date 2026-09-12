# TD-34: 移动端真机测试方案 (书面方案, 需真机/外部设备池)

> 状态: 📄 书面方案 — 需真机设备池, 本地无法闭环
> 日期: 2026-09-13
> 关联: R-09 (移动端性能基线)、webgl-render-manager.ts (WebGL 主路径)、webgpu-render-manager.ts (WebGPU 实验路径)

## 1. 背景

renderer-three 双后端 (WebGL2 Spark / WebGPU 自研) 的移动端行为存在已知风险面:

- **内存**: 全量 SPLAT 常驻显存, 移动端 GPU 显存预算 1-2 GB 量级, 需要 LOD/降采样配合;
- **context lost**: WebGL context 丢失 (系统内存压力 / 后台切换 / 驱动重置), 当前
  `renderer-three` 无 contextlost 事件处理;
- **COOP/COEP**: SPZ/SOG 流式加载走 Worker + SharedArrayBuffer 路径时, 需要
  Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy 头, 移动端浏览器兼容性
  与桌面不同;
- **WebGPU**: 移动端 Safari (iOS 17.4+ 部分实验)、Chrome Android 覆盖面窄, 需真机验证。

## 2. 设备矩阵 (建议)

| 分层 | 平台 | 设备 (建议) | 覆盖点 |
| --- | --- | --- | --- |
| P0 旗舰 (年度覆盖) | iOS | iPhone 15 Pro / 16 Pro (A17 Pro, 8GB) | WebGPU 实验路径、Metal 驱动、Safari 全屏 |
| P0 旗舰 (年度覆盖) | Android | Galaxy S24 / Pixel 9 (Adreno 750 / Mali-G715) | WebGPU (Chrome)、Vulkan 驱动的 WebGL |
| P1 中端 | iOS | iPhone 12/13 (A14/A15) | 内存预算下限 4 GB、降采样/LOD 生效 |
| P1 中端 | Android | Pixel 7 / 一加 11 (中端 Adreno) | context lost 高频场景 |
| P2 低端 (季度抽测) | Android | Redmi Note 系列 (Mali-G52 级) | 崩溃/黑屏回归、最低配置下限 |

**真机 vs 模拟器**: 必须真机 — 模拟器无法复现 GPU 驱动差异、内存压力、热节流、后台切换。

## 3. 测试矩阵

| 用例组 | 用例 | 断言/观测 | 关联项 |
| --- | --- | --- | --- |
| 加载 | 大场景 (≥1M splat) 全量加载耗时 | 首帧 ≤ 5s (WiFi)、无 OOM 崩溃 | C-07/TD-15 (预裁剪/quickselect) |
| 加载 | SPZ v2 (gzip) 流式加载 | 进度回调单调递增、内存峰值 ≤ 设备预算 | C-03 |
| 渲染 | 基准场景帧率 (Garden 级) | P50 ≥ 30 FPS、P95 ≥ 20 FPS (中端) | R-09 基线 |
| 渲染 | DPR 变化 (横竖屏切换 / 浏览器缩放) | 分辨率回调触发、无闪烁 | N-05 |
| 稳定性 | 后台切换 (Home → 回前台) | 恢复无黑屏、无 context 重建失败 | TD-34 §4 |
| 稳定性 | 内存压力 (连续加载/切换 5 场景) | 无 OOM 白屏、GPU 内存回落 | LOD/降采样 |
| 互操作 | Worker + SAB 流式加载 | 需 COOP/COEP 头时行为正确 | TD-34 §5 |
| WebGPU | Chrome Android / iOS Safari 实验开关 | 回退到 WebGL2 无异常、无双重渲染 | R-03 |
| 交互 | 拖拽/缩放/全屏 | DragLookControls 无抖动、fullscreen 切换正常 | TD-36 |

## 4. context lost 验证流程

当前 renderer-three **未实现** `webglcontextlost` / `webglcontextrestored` 监听。

**验证流程 (真机)**:
1. 加载大场景 → 进入加载页 → 强制后台 (Home 键) → 等 30-60s → 回前台;
2. 记录: 是否触发 contextlost、Spark 是否自动恢复、画面是否重建;
3. 对照实验: 在桌面 Chrome DevTools 手动触发 `WEBGL_lose_context.loseContext()`,
   供本地预处理验证。

**落地建议 (随真机批次)**: 在 `webgl-render-manager.ts` 增加:

```ts
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // 允许恢复
  // 暂停渲染循环 + 通知上层 (事件: renderer:contextlost)
});
canvas.addEventListener('webglcontextrestored', () => {
  // 重传全部 buffer + 重建 renderer (Spark 需重新初始化)
});
```

## 5. COOP/COEP 验证

SPZ/SOG 流式 Worker 路径若使用 SharedArrayBuffer, 需要 `Cross-Origin-Opener-Policy:
same-origin` + `Cross-Origin-Embedder-Policy: require-corp` 响应头。

- **验证点**: 在启用 COOP/COEP 的部署 (demo 站) 上验证移动端 Safari/Chrome 的
  Worker + SAB 加载;
- **注意**: iOS Safari 对 COOP/COEP 支持晚于 Chrome; 若目标部署无法保证响应头,
  需在 Worker 侧去掉 SAB 依赖 (fallback 到 postMessage 复制) — 这是 C-08 的关联决策点。

## 6. 执行方式建议

1. **设备池**: BrowserStack / Sauce Labs 移动云真机 (含 iOS 真机) 或团队自有设备柜;
2. **自动化**: Playwright 移动端模拟 (仅做基础回归, 不替代真机); 真机流程输出
   手工/半自动检查单 (本文件作为检查单基准);
3. **门禁**: 真机批次纳入 CI 手动触发 job (workflow_dispatch), 不阻塞本地提交。

## 7. 结论

真机测试不可本地闭环。本文档作为检查单基准, 需设备池资源后执行。**当前分支
不落地代码** — 仅将 context lost 处理与 COOP/COEP 决策点 (C-08) 记录为待办。