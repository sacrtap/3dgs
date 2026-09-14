## Directory: scripts

机械门禁工具集：pre-commit hook 与 CI 共用的确定性校验脚本。**scripts
承担 R-15/R-16 机械 review 触发与修复产物完整性检查的关键组件**
（见根 AGENTS.md Internal Markers 注册表与 Repair Artifacts Policy）。

## Responsibilities

| 脚本 | 用途 | 入口 |
|------|------|------|
| `guard-paths.mjs` | pre-commit 拦截 Do Not Touch 路径（正则豁免 `.changeset/*.md\|json`） | pre-commit 第 1 步 |
| `check-agent-assets.mjs` | 资产盘点：嵌套 AGENTS.md 与 `.husky/pre-commit` 双向核对 + hook 挂载校验 | pre-commit 第 2 步 + CI |
| `affected-test.mjs` | 增量测试：只跑受影响包的测试（`--staged` 本地 / `--base <ref>` CI） | pre-commit + CI |
| `check-agents-refs.mjs` | AGENTS.md Internal Markers 引用检查：路径存在性 + §D-xx/§R-xx 锚点 token 校验 | CI |
| `compare-quality.mjs` | 转换质量数值分析：源文件 vs 转换产物逐属性对比 | 手动 |
| `clean.mjs` | 跨平台清理（D-14）：替代各包 `rm -rf dist`，Windows PowerShell 下失效问题 | `pnpm clean` |

## Validation Commands

```sh
# 门禁链单脚本手动运行（修改后必须实测退出码）
node scripts/guard-paths.mjs            # exit 0 = 无违规; 1 = 列出违规路径
node scripts/check-agent-assets.mjs     # exit 0 = 资产完整; 1 = 列出盘点缺口; --json 输出计数
node scripts/check-agents-refs.mjs      # exit 0 = 引用有效; 1 = 列出断链

# 完整 pre-commit 链（含 lint-staged）
sh .husky/pre-commit

# 受影响测试（本地/CI）
node scripts/affected-test.mjs --base origin/main
node scripts/affected-test.mjs --staged

# 转换质量分析（大文件需提高堆上限）
node --max-old-space-size=8192 scripts/compare-quality.mjs
```

## Regression Hotspots

- 任何门禁脚本改动 = pre-commit 与 CI 双入口行为同步变化：改后必须在
  `.husky/pre-commit` 实跑验证（`sh .husky/pre-commit`），不能只看脚本本身
- `check-agents-refs.mjs` / `check-agent-assets.mjs` 是 R-15/R-16 机械 review
  关键组件，断链即覆盖空洞；修改后需用正向 + 负向场景（临时缺失）验证退出码
- `guard-paths.mjs` 的 FORBIDDEN/ALLOWED 正则与根 AGENTS.md Do Not Touch
  段、`.gitignore` 三方需保持语义一致（曾因 `.changeset` 豁免规则调整导致发布链路风险）

## Do Not Touch (inherited)

- `dist/`, `coverage/`, `.changeset/` — 构建产物与工具管理
- 脚本只读仓库数据，不写除报告外的产物；临时调试输出不得入库