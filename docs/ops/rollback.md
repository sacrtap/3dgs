# 发布回滚与恢复路径 (R-15)

本文档记录发布链的**回滚/恢复路径**：如何撤回一次已发布的 npm 版本、如何恢复
被破坏的 main 分支、以及 CI 门禁与分支保护的现状（哪些保护是外部的、不可从
本仓库配置）。任何发布操作前请先读本节。

## 1. 发布链现状

- **发布方式**: `changesets/action@v1`（`.github/workflows/release.yml`）。
  流程为 `pnpm changeset version` 生成版本 PR → 合并后 `pnpm changeset publish`
  发布到 npm。每次发布打 tag，格式 `@3dgs/<package>@<version>`
  （例: `@3dgs/renderer-three@0.3.0`）。
- **门禁链**: CI（`.github/workflows/ci.yml`）在合并前跑
  lint → format → build → typecheck → 测试（push 时含 coverage 阈值门禁）
  → demo/docs build；push 后跑 benchmark（--gate: P50 >= 30fps）与
  render-smoke E2E。
- **分支保护**: 合并接受依赖 GitHub 外部保护规则（GHE 分支保护 / 必填 check）。
  本仓库无法从 `.github/` 内查看或修改这些规则；如发现合并未强制通过 CI，
  需在 GitHub 仓库设置 → Branches 中核对该分支的 "Require status checks"
  是否勾选。**这是外部配置，本仓库不持有。**

## 2. 已发布版本回滚（npm 层）

npm 不允许删除已发布的版本（除非 72 小时内联系 npm 支持 unpublish 且该版本
无依赖方）。因此"回滚"= **发布一个修复版本**，恢复路径分两步：

### 2.1 立即止血：将破坏性提交从 main 回退

```sh
# 找到破坏性发布对应的提交 (changesets 版本 PR 的 merge commit)
git log --oneline --grep="chore(release): version packages" -n 5

# 回退该提交 (保留历史, 生成反向提交)
git revert -m 1 <merge-commit-sha>
git push origin main
```

回退后 CI 自动重跑；**合并前请确认** CI（含 coverage 阈值与 affected-test）
通过，否则回退提交自身也会被保护规则拦截。

### 2.2 恢复 npm 包：走 changesets 发布一个 patch 版本

```sh
# 1) 在回退后的 main 上写一个 changeset, 标记受影响包的 patch bump
pnpm changeset add --patch   # 选择受影响包, 描述回滚原因
# 2) 提交并推 PR (changesets/action 会生成版本 PR)
git add .changeset/ && git commit -m "chore: revert <package> to working state"
git push origin <your-branch>
# 3) 合并版本 PR → release.yml 自动发布 patch 版本到 npm
```

消费者通过升级 patch 版本获得修复；已有引用旧版本的应用可继续用旧版本
（npm 版本不可变，旧版本仍可用）。

## 3. 仅 tag 错误（尚未发布）时的处理

若 release.yml 的 dry_run 已生成版本 PR 或已打 tag 但 `publish` 步骤失败/
被中止（npm 未收到包），可删除 tag 后重新触发：

```sh
# 删除远程 tag (仅在确认 npm 未发布时)
git push origin :refs/tags/@3dgs/<package>@<version>
# 重新触发 release (workflow_dispatch, dry_run 先验证)
```

## 4. 恢复被破坏的 main（未发布场景）

```sh
# 重置 main 到最后一个已知良好提交 (force-push 前必须通知所有协作者)
git fetch origin
git reset --hard origin/main~1        # 或指向具体良好 sha
git push --force-with-lease origin main
```

`force-with-lease` 防止覆盖他人新推送。CI 自动重跑验证恢复点。

## 5. 何时需要升级/降级处理

- **安全漏洞**: 立即发布 patch（2.2），并考虑在 README 或公告中标注受影响
  版本区间。
- **破坏性 API 变更被误发**: 除 2.2 的 patch 外，追加一个 minor 变更
  `changeset add --minor` 恢复旧 API 兼容层（如果策略允许），并更新文档。
- **benchmark 门禁失败**: 属性能回退而非发布回滚，先查
  `benchmarks/reports/` 最近一次通过值对比，再定位渲染改动。

## 6. 预防性检查清单

发布前在版本 PR 上人工核对：

- [ ] CI 全部绿（含 coverage 阈值门禁）
- [ ] benchmark 最近一次 push 通过（P50 >= 30fps）
- [ ] render-smoke E2E 通过（首帧渲染 + 无 console 错误）
- [ ] changeset 仅包含预期的包与 bump 级别
- [ ] 若涉及破坏性变更, 确认 major bump 且 README 迁移说明已更新
