## Package: convert

3DGS 格式转换工具，支持 PLY、SOG、SPZ、SPLAT 等格式的读写。

## Risk Files (from root AGENTS.md)

这是最高变更率的包。回归候选集中在以下文件：

- `src/cli.ts` — 命令行入口，参数解析、子命令路由
- `src/ply-parser.ts` — PLY 格式解析，二进制/ASCII 模式
- `src/sog-writer.ts` — SOG 格式写入，分块策略

## Edit Boundaries

### cli.ts 职责边界

- 子命令定义 (`convert`, `info`, `validate`)
- 参数校验
- 进度报告

**修改时检查**:
- `pnpm test` — 确保 `convert-e2e.test.ts` 通过
- 手动测试: `node packages/convert/dist/cli.js --help`

### ply-parser.ts 职责边界

- 头部解析 (element, property, format)
- 二进制 little-endian / big-endian
- ASCII 模式
- 属性映射 (x, y, z, red, green, blue, alpha, f_dc_*)

**修改时检查**:
- `pnpm test` — 确保 `ply-parser.test.ts` 通过
- 边界情况: 空文件、损坏头部、非标准属性

### sog-writer.ts 职责边界

- 分块策略 (chunk size, compression)
- 元数据写入
- 与 `sog-streamer.ts` 的协议一致性

**修改时检查**:
- `pnpm test` — 确保以下测试通过:
  - `sog-writer.test.ts`
  - `convert-e2e.test.ts` (端到端)
- 验证: 写入后能正确读回

## Cross-File Dependencies

| 风险文件 | 关联文件 | 检查点 |
|---------|---------|--------|
| `cli.ts` | `processing.ts`, `index.ts` | 子命令参数传递 |
| `ply-parser.ts` | `gaussian-loader.ts`, `splat-reader.ts` | 属性映射一致性 |
| `sog-writer.ts` | `sog-streamer.ts` (renderer-three) | 格式协议 |

## Validation Commands

```sh
# 完整验证
pnpm test -- packages/convert
pnpm typecheck

# 受影响测试文件
pnpm test -- --related packages/convert/src/ply-parser.ts
```

## Regression Hotspots

以下组合曾频繁出现回归，修改时需额外注意：

- `ply-parser.ts` + `processing.test.ts` — 属性映射变更
- `sog-writer.ts` + `convert-e2e.test.ts` — 端到端流程
- `cli.ts` + 所有 `*.test.ts` — 参数变更影响全局

## Do Not Touch (inherited)

- `dist/` — 构建产物
- `*.ply`, `*.sog`, `*.splat`, `*.spz` — 大型数据文件 (gitignored)
