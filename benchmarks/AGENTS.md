## Directory: benchmarks

3DGS 性能基准测试目录：Playwright 驱动 demo 采集 FPS/帧时间/内存，产出
原始 JSON 与 Markdown 报告。**benchmarks 承担 R-07 性能门禁定义与 R-14
render-smoke 检验入口**（见根 AGENTS.md Internal Markers 注册表）。

## Responsibilities

- `benchmark.ts` — 主基准测试（v2）: 页面只加载一次、场景按钮切换、
  WASD 移动状态对比、GPU/浏览器信息采集；输出 JSON raw + Markdown 报告
- `perf-monitor.ts` — 性能监控数据采集辅助
- `probe-*.mjs` / `run-*.mjs` — 各类探针与批量运行脚本（fps / spz / convert 等）
- `verify-*.mjs` — 插件与空间验证脚本
- `benchmarks/reports/` — 基准输出（gitignored，Do Not Touch）

## CI Gate (R-07)

`.github/workflows/ci.yml` benchmark job（仅 push 触发，Node 22）：

```text
pnpm build → 启动 demo server（30s 轮询就绪）→ npx tsx e2e/render-smoke.ts → npx tsx benchmarks/benchmark.ts --gate
```

- `--gate`: 任一场景 P50 < 30fps 时 CI 失败（R-07 门禁）
- `e2e/render-smoke.ts`: renderer browser E2E 冒烟（R-14，属于 e2e 目录但由
  benchmark job 执行——修改入口时需同步确认 CI 调用路径）

## Validation Commands

```sh
# 完整基准（前置: pnpm build + demo dev server + playwright chromium）
npx tsx benchmarks/benchmark.ts

# CI 门禁模式（需 demo server 已在运行）
npx tsx benchmarks/benchmark.ts --gate

# render-smoke E2E（benchmark job 中的前置冒烟）
npx tsx e2e/render-smoke.ts
```

## Regression Hotspots

- `benchmark.ts` 场景增删/阈值调整 — 必须同时核对 `--gate` 语义与
  ci.yml benchmark job（门禁参数与脚本共同演化，改动需机械验证）
- demo server 启动/就绪探测改动 — CI 用 30s 轮询，本地与 CI 行为需一致
- `benchmark.ts` 30 天 5 commits / churn=669，属高频演化区，改动时跑一次
  `--gate` 模式确认不破坏门禁契约

## Do Not Touch (inherited)

- `benchmarks/reports/` — gitignored 基准输出，不入库
- `dist/`, `coverage/`, `.changeset/` — 构建产物与工具管理