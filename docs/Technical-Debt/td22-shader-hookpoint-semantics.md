# TD-22: ShaderHookPoint 语义清理方案 (书面方案, 待 major 版本执行)

> 状态: 📄 书面方案 — 涉及公共 API 破坏性变更, 按 major 版本节奏执行, 不自动落地
> 日期: 2026-09-13
> 关联: `packages/core/src/renderer-adapter.ts` (枚举定义)、`webgl-render-manager.ts:1028-1061`、
> `webgpu-render-manager.ts:1271-1292`、`packages/plugins/src/shader-injection/`

## 1. 背景: FRAGMENT_BEFORE_OUTPUT 语义漂移

`ShaderHookPoint` 枚举 (renderer-adapter.ts:52-75) 声明 6 个钩子:

| 钩子 | 文档语义 | 实际注入位置 |
| --- | --- | --- |
| `VERTEX_MAIN_BEGIN` | vs main() 开头 | vs main() 开头 ✅ |
| `VERTEX_BEFORE_POSITION` | gl_Position 赋值前 | vs gl_Position 赋值前 ✅ |
| `VERTEX_MAIN_END` | vs main() 结尾 | vs main() 结尾 ✅ |
| `FRAGMENT_MAIN_BEGIN` | fs main() 开头 | fs main() 开头 ✅ |
| `FRAGMENT_BEFORE_OUTPUT` | **颜色输出前 (fragColor 赋值前)** | **fs main() 末尾 (赋值后)** ❌ 漂移 |
| `FRAGMENT_MAIN_END` | fs main() 结尾 | fs main() 结尾 ✅ |

**漂移根因 (D-12 注释)**: Spark GLSL3 下 `fragColor` 赋值时序问题, 该钩子被实现为
注入到 main() **末尾** (fragColor 赋值之后), 行为与 `FRAGMENT_MAIN_END` 完全相同。
枚举值已在代码中标注 `@deprecated`, 但**未进入公共类型/文档的正式迁移路径**。

**当前代码事实** (2026-09-13 核检):

- `webgl-render-manager.ts:1041-1044` 与 `webgpu-render-manager.ts:1284-1287`:
  两端实现一致 — `FRAGMENT_BEFORE_OUTPUT` 都走 `injectBeforeMainEnd` (main 末尾),
  与 `FRAGMENT_MAIN_END` 分支完全相同。语义重叠, 无行为差异。
- `renderer-adapter.ts:170-173` 公共 API 示例文档仍演示 `FRAGMENT_BEFORE_OUTPUT` 用法;
  `plugins/src/shader-injection/index.ts:23-67` 示例注释同样使用该值 — **文档与实现不一致**。
- `plugins/src/shader-injection/presets.ts` 全部预设使用 `FRAGMENT_MAIN_END` (71-152 行),
  未依赖旧语义。
- 测试: `webgpu-render-manager.test.ts:412-415` 使用 `FRAGMENT_BEFORE_OUTPUT` 仅验证
  注入幂等性 (无输出语义断言)。

## 2. 影响面分析

| 影响面 | 详情 |
| --- | --- |
| 公共 API 破坏 | `ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT` 被移除 → 外部用户编译失败 |
| 行为破坏 | 依赖旧语义"输出前修改"的注入代码 (若存在) 行为变化 |
| 内部使用 | renderer 两端 switch 分支可合并; plugins presets 已用 MAIN_END, 零改动 |
| 文档 | renderer-adapter.ts 示例 + shader-injection 插件 README 需同步更新 |

**旧语义假设的注入代码 (FRAGMENT_BEFORE_OUTPUT)**: 因为两值实际行为相同, 任何在
`FRAGMENT_BEFORE_OUTPUT` 下工作的代码, 在 `FRAGMENT_MAIN_END` 下同样工作。
不存在"只在 BEFORE_OUTPUT 能跑、MAIN_END 不能跑"的存量代码。

## 3. 方案对比

| 方案 | 做法 | 破坏性 | 推荐 |
| --- | --- | --- | --- |
| A. 合并语义, 移除枚举值 | 删除 `FRAGMENT_BEFORE_OUTPUT`, 文档示例改用 `FRAGMENT_MAIN_END`; switch 分支合并 | 编译期破坏 (枚举成员消失) | ✅ 推荐 |
| B. 恢复"输出前"真语义 | 在 fragColor 赋值**前**注入 (需定位 Spark shader 源码中的赋值点) | 运行期行为破坏 + 实现脆弱 | ❌ 不推荐 |
| C. 保留别名不动 | 维持 deprecated 现状 | 无 | ❌ 长期拖债 |

**推荐 A 的理由**:
1. 两值**实际行为完全一致**, 合并后无任何运行期行为变化 — 唯一破坏是编译期
   枚举成员消失, 可被 `pnpm typecheck` 立即发现并机械替换。
2. "输出前"语义在 Spark 的 GLSL3 下**不可靠实现**: fragColor 是 fs main 内局部变量,
   钩子代码不可能插到赋值语句之间 (注入点在函数边界)。恢复真语义需改 Spark shader 源码,
   超出本仓库可控范围。
3. WebGPU 端 WGSL 同理: `output.color` 是结构体字段, 无法在赋值前注入。

## 4. 执行步骤 (major 版本)

1. **vNext (当前分支不执行, 仅记录)**:
   - `renderer-adapter.ts` 枚举删除 `FRAGMENT_BEFORE_OUTPUT`; JSDoc 保留一段
     "migration note" 说明映射关系。
   - `webgl-render-manager.ts` / `webgpu-render-manager.ts` switch 移除对应 case
     (与 `FRAGMENT_MAIN_END` 合并)。
   - `renderer-adapter.ts` 示例注释、`plugins/src/shader-injection/index.ts` 示例、
     `plugins` README 全部改用 `FRAGMENT_MAIN_END`。
   - `webgpu-render-manager.test.ts:412-415` 改用 `FRAGMENT_MAIN_END`。
2. **迁移工具** (可选): 提供 codemod 脚本 `scripts/migrate-fragment-hook.mjs` —
   正则替换 `ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT` → `ShaderHookPoint.FRAGMENT_MAIN_END`,
   供外部用户批量迁移。
3. **CHANGELOG/迁移指南**: 在 major 发布说明中列明该破坏项与一键替换方法。

## 5. 验收信号 (执行时)

- `pnpm typecheck` 全绿 (无残留 `FRAGMENT_BEFORE_OUTPUT` 引用)。
- `pnpm lint` 全绿; `pnpm test` 全绿 (shader-injection 插件测试 + renderer 注入测试)。
- `grep -r FRAGMENT_BEFORE_OUTPUT packages/` 无匹配。
- 插件预设测试 `presets.test.ts` 不变仍绿 (预设全部走 MAIN_END, 无需改动)。

## 6. 结论

采用方案 A (合并语义, 移除枚举值), 在下一个 major 版本随其他破坏性变更一起执行。
当前分支**不落地** — 该清理不修复任何运行期缺陷, 只消除 API 债务, 单独执行会
放大版本噪音。
