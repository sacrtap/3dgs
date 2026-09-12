# R-08: Windows CI 方案 (书面方案, 需外部 CI 资源)

> 状态: 📄 书面方案 — Windows runner 需 GitHub Actions 或自建 CI, 本地 (macOS) 无法闭环
> 日期: 2026-09-13
> 关联: `.github/workflows/ci.yml`、AGENTS.md (pnpm monorepo)、Node 22+ / pnpm 9

## 1. 背景

当前 CI (`ci.yml`) 在 macOS/Linux runner 上验证 test/typecheck/lint/build。
Windows runner 的增量价值:

- **跨平台回归**: 路径分隔符、`spawn`/`execFile` 差异 (CLI 测试用 `execFileSync(process.execPath, ...)`)、
  shebang/权限差异、`pnpm` 在 Windows 的行为;
- **convert CLI 消费面**: `cli.ts` 是 Node CLI, Windows 用户是目标人群之一;
- **demo/r3f 构建**: vite 在 Windows 的产物差异。

## 2. Runner 方案

| 方案 | 成本 | 覆盖 | 推荐 |
| --- | --- | --- | --- |
| GitHub Actions `windows-latest` 附加 job | 免费额度内 | 全量门禁 × 1 OS | ✅ 推荐 |
| 自建 Windows runner | 需维护 | 灵活 | 团队已有基础设施时 |
| 仅 Linux 交叉验证 (不推荐) | 0 | 无真实 Windows | ❌ |

**推荐**: 在现有 `ci.yml` 增加一个 `windows` job, 复用同一套 `pnpm install` →
`pnpm test` → `pnpm typecheck` → `pnpm lint` → `pnpm build` 流程。

## 3. workflow 增补 (草案)

```yaml
# .github/workflows/ci.yml 追加
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: corepack enable          # 或 pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test                # vitest run
      - run: pnpm typecheck           # 注意: 需与本仓库本地一致, 见 §4
      - run: pnpm lint
      - run: pnpm --filter @3dgs/core build && pnpm build
```

## 4. 跨平台注意点 (执行时核检)

1. **typecheck 脚本**: 根脚本 `--no-bail exec tsc --noEmit` 在 Windows (cmd/PowerShell)
   下解析行为不同 — 本地 macOS 已发现 `sh -c` 解析到全局 tsc 的问题; Windows 需
   验证 `pnpm exec tsc` 解析到本地 `node_modules/.bin`。建议 CI 用与本地一致的
   显式命令: `pnpm --filter "@3dgs/*" --filter "!@3dgs/demo" --filter "!@3dgs/docs" --no-bail exec -- tsc --noEmit`。
2. **CLI 测试路径**: `cli.test.ts` 用 `execFileSync(process.execPath, ['--import', 'tsx', cliEntry, ...])` —
   Windows 下 `tsx` 的 shebang 与路径分隔符需验证; `cli.ts` 的 `process.cwd()` 相对路径
   输出在 Windows 用反斜杠, manifest 内路径断言需 `path.normalize` 或统一 `/`。
3. **fixture 生成**: `make3dgsPlyFile` 写临时文件, Windows 需 `fs.mkdtempSync` 在
   `os.tmpdir()` 下 (测试已用子目录隔离, 验证 Windows 无保留句柄问题)。
4. **行尾**: `.gitattributes` 缺省时 CRLF 可能影响 `*.ply`/`*.sog` 二进制 fixture —
   fixture 以生成器形式存在 (C-09), 无二进制提交, 风险低; 但 `.md` 文档 diff 噪音
   建议加 `* text=auto eol=lf`。
5. **性能敏感测试**: soa.test.ts 跨分块用例 (20s 超时) 在 Windows runner 更慢,
   若超时需按 CPU 核数调整超时或限制 vitest 并行 (poolOptions)。

## 5. 验收信号 (执行时)

- Windows job 全绿 (test/typecheck/lint/build);
- `cli.test.ts` 9+2 用例在 Windows 通过;
- 无 CRLF 相关的 fixture 损坏告警。

## 6. 结论

增加 GitHub Actions `windows-latest` job, 复用现有流程 + §4 注意点。
当前本地无法执行 Windows 验证, 文档化后待 CI 资源落地。