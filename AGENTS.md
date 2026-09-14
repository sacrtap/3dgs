## Session
回复及思考过程均使用中文。

## Project

pnpm monorepo for a lightweight Web 3DGS rendering engine and tour framework.
6 publishable packages: `core`, `renderer-three`, `convert`, `plugins`, `react`, `vue`.
Workspace layout declared in `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `docs/site`.
Runtime: Node >= 22 (jsdom 30 runtime requires Node 22+; vitest 4 requires Node 20+), pnpm >= 9. TypeScript strict mode (`tsconfig.base.json`).
Node version policy (R-13): 单一版本策略 — 根 engines `>=22` 是唯一权威声明；CI build-and-test 矩阵 `[22, 24]`、benchmark 与 release 均运行 Node 22（曾为 20, 属无意选择已统一）。新增 workflow 的 setup-node 必须使用 `>=22` 内的版本, 不引入低于 engines 的版本; 若确需更低版本, 必须在 workflow 注释中记录兼容理由。

### Package-local AGENTS

高变更率包的职责边界、验证命令与回归热点见各包局部指令文件：

- `packages/convert/AGENTS.md` — 格式转换 (cli/ply-parser/sog-writer)
- `packages/renderer-three/AGENTS.md` — 渲染器 (index/webgpu-render-manager)
- `packages/core/AGENTS.md` — 漫游核心 (tour-player/scene-manager/renderer-adapter)
- `packages/plugins/AGENTS.md` — 插件 (hotspot/media-embed/scene-transition)

Agent 资产盘点 (嵌套 AGENTS.md 与 `.husky/pre-commit` hook) 由
`node scripts/check-agent-assets.mjs` 校验: 新增嵌套 AGENTS.md 必须在本段
登记, 删除文件必须同步移除引用, 否则本地 pre-commit 与 CI 均失败。

## Commands

```sh
pnpm install          # install deps
pnpm build            # build all packages (pnpm -r run build)
pnpm test             # run all tests (vitest run)
pnpm test:watch       # watch mode
pnpm test:coverage    # with v8 coverage
pnpm lint             # eslint --max-warnings 0 on packages/*/src
pnpm lint:fix         # eslint --fix
pnpm format           # prettier --write
pnpm format:check     # prettier --check
pnpm typecheck        # tsc --noEmit (excludes demo & docs)
pnpm clean            # remove all dist/ dirs
```

## Counterintuitive Patterns

- **Tests resolve source directly, not dist.** `vitest.config.ts` aliases
  `@3dgs/core`, `@3dgs/plugins`, `@3dgs/convert`, `@3dgs/renderer-three` to
  `packages/*/src/index.ts`. A fresh clone can run `pnpm test` without `pnpm
  build` first. Do not change this without understanding the D-15 comment.
- **Package exports point to `dist/`.** Consumers in production use built
  output; only the test harness bypasses this.

## Internal Markers (D-xx / R-xx 标记注册表)

源码与 workflow 中的 `D-xx`（设计/债务项）与 `R-xx`（风险项）标记的含义与定义：

- **D-15 — 测试基础设施：免构建运行 + 覆盖缺口**。根因: 包 `exports` 指向
  `dist/`, vitest 无法直接解析源码; `vitest.config.ts` 的 `@3dgs/* → src`
  别名是修复的一部分, 改别名前必须理解该债务背景。定义全文:
  `docs/technical-debt-plan.md` §D-15。别名落在 `vitest.config.ts`。
- **R-07 — 基准测试纳入 CI 门禁**。`.github/workflows/ci.yml` benchmark job 的 `--gate` 门禁:
  任一场景 P50 < 30fps 时 CI 失败。定义全文:
  `docs/Technical-Debt/execution-plan-2026-09-13.md` §R-07。
- **R-13 — Node 版本单一策略**。见本文件 "Node version policy" 段
  (根 engines `>=22` 唯一权威, 新增 workflow setup-node 必须 `>=22`)。
- **R-14 — coverage 阈值门禁与 renderer browser E2E**。见
  `vitest.config.ts` thresholds 注释与 `e2e/render-smoke.ts` 头部说明。
- **R-15 — CODEOWNERS 机械 review 与发布回滚路径**。见
  `.github/CODEOWNERS` 与 `docs/ops/rollback.md`。

新增 `D-xx`/`R-xx` 标记时, 必须在此注册表补一行定义与指向; 删除或变更既有
标记时, 同步更新本段与所指文档。

## Repair Artifacts Policy (R-16)

修复 Better Harness finding 时, 修复产物必须**随修复 commit 入库**, 防止
dormant 状态 (文件存在于 working tree 但未 tracked, 机械 review 触发与
嵌套覆盖不被 git/harness 承认):

- 每条 finding 的修复产物 (Code/Test/Config/Rule/Document/Script) 在独立
  review 判定后**同一提交**纳入版本控制; 禁止停留在 untracked 状态收尾。
- 入库范围与 finding 属主一致: CODEOWNERS / 嵌套 AGENTS / rollback 文档 /
  E2E / trace-* 工具等, 均随修复 commit 入库并在提交信息注明 finding id。
- `docs/better-reports/**` 为报告 artifacts, **不随修复入库** (见
  `report-artifacts-pollute-diff` finding 的入库策略); 报告目录始终 gitignored 或独立归档。
- 提交信息格式: `chore(harness): 修复 <finding-id> — <简要描述>`; 若一条
  commit 含多个 finding 的产物, 逐个列出 finding id。

## Risk Controls

- `renderer-three/src/index.ts` (~1489 lines) and
  `webgpu-render-manager.ts` (~1740 lines) are decision-dense files managing
  WebGL/WebGPU lifecycle, controls, LOD, SOG streaming, frustum culling, buffer
  pools, and shader injection. Edits to one responsibility can affect others;
  scope changes narrowly.
- `packages/convert` is the highest-churn package. Regression candidates
  cluster around `cli.ts`, `ply-parser.ts`, and `sog-writer.ts` with
  co-change test files.

## Do Not Touch

- `dist/`, `coverage/` — generated or managed by tooling.
- `.changeset/` — 仅 tooling 产物禁止手改; 手写 changeset 文件
  (`*.md`, 声明 bump 类型) 是 release 流程合法输入, 允许入库
  (guard-paths.mjs 已豁免 .md)。
- `benchmarks/reports/` — gitignored benchmark output.
- `*.ply`, `*.sog`, `*.splat`, `*.spz` — large data files, gitignored except
  `apps/demo/public/kitchen.*` demo assets.
- `banks/` — internal database, gitignored.
- `docs/better-reports/` — Better Harness 报告 artifacts（R-16），gitignored
  不入库（已写入 .gitignore，避免报告/evidence 计入 git diff 与 churn 统计）。
