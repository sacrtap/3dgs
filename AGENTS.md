## Session
回复及思考过程均使用中文。

## Project

pnpm monorepo for a lightweight Web 3DGS rendering engine and tour framework.
6 publishable packages: `core`, `renderer-three`, `convert`, `plugins`, `react`, `vue`.
Workspace layout declared in `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `docs/site`.
Runtime: Node >= 22 (jsdom 30 runtime requires Node 22+; vitest 4 requires Node 20+), pnpm >= 9. TypeScript strict mode (`tsconfig.base.json`).

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

- `dist/`, `coverage/`, `.changeset/` — generated or managed by tooling.
- `benchmarks/reports/` — gitignored benchmark output.
- `*.ply`, `*.sog`, `*.splat`, `*.spz` — large data files, gitignored except
  `apps/demo/public/kitchen.*` demo assets.
- `banks/` — internal database, gitignored.
