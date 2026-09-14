## Package: renderer-three

Three.js 渲染器实现，管理 WebGL/WebGPU 生命周期、LOD、SOG 流式传输、视锥剔除、缓冲池和着色器注入。

## Risk Files (from root AGENTS.md)

以下文件为决策密集文件，编辑时需格外谨慎：

- `src/index.ts` (~1489 lines) — 主入口，管理渲染管线、LOD 切换、设备分层
- `src/webgpu-render-manager.ts` (~1740 lines) — WebGPU 渲染管理器，处理缓冲池、视锥剔除、排序

## Edit Boundaries

### index.ts 职责边界

- 渲染器工厂 (`createRenderer`)
- LOD 策略 (`adaptive-resolution.ts` 配合)
- 设备分层 (`device-tier.ts`)
- 帧回调管理 (`frame-callback-manager.ts`)

**修改时检查**:
- `pnpm test` — 确保 `index-pipeline.test.ts` 通过
- `pnpm typecheck` — 类型签名变更需全局验证

### webgpu-render-manager.ts 职责边界

- 缓冲池管理 (`buffer-pool.ts`)
- 视锥剔除 (`frustum-culling.ts`)
- 排序策略 (`webgpu-sort-manager.ts`)
- 相机矩阵缓存 (`camera-matrix-cache.ts`)

**修改时检查**:
- `pnpm test` — 确保以下测试通过:
  - `webgpu-render-manager.test.ts`
  - `buffer-pool.test.ts`
  - `frustum-culling.test.ts`
  - `webgpu-sort-manager.test.ts`
  - `camera-matrix-cache.test.ts`
- `pnpm typecheck` — WebGPU 类型变更影响面大

## Cross-File Dependencies

编辑上述风险文件时，需检查以下关联文件：

| 风险文件 | 关联文件 | 检查点 |
|---------|---------|--------|
| `index.ts` | `adaptive-resolution.ts`, `device-tier.ts`, `frame-callback-manager.ts` | 接口签名一致性 |
| `webgpu-render-manager.ts` | `buffer-pool.ts`, `frustum-culling.ts`, `webgpu-sort-manager.ts`, `camera-matrix-cache.ts` | 数据流、缓冲生命周期 |

## Validation Commands

```sh
# 完整验证
pnpm test -- packages/renderer-three
pnpm typecheck

# 受影响测试文件
pnpm test -- --related packages/renderer-three/src/index.ts
```

## WebGPU 失败分支覆盖边界

`webgpu-render-manager.ts` 的失败路径在 `webgpu-render-manager.test.ts`
「失败路径观测」describe 中分两类处理：

- **jsdom 可断言**（已覆盖）:
  - `constructor:experimental` — 构造即触发 warn, spy `console.warn` 断言稳定事件标识
  - `init:gpu-device-lost` — mock `navigator.gpu` + `device.lost` deferred, spy
    `console.error` 断言错误消息透传
- **显式豁免**（不写 jsdom 断言）:
  - `renderLoop:gpu-sort-failed` — 依赖真实 GPU 管线（`WebGPUSortManager.init`
    的 `device.createBuffer`/`queue.writeBuffer` + canvas `webgpu` context）,
    jsdom 下无真实 WebGPU 实现, mock 面过大会让测试退化为 mock 深水区。
    此分支需真实 WebGPU 环境（浏览器手测或未来 WebGPU browser E2E）验证,
    单元测试不覆盖属于已知边界而非遗漏。

修改 `webgpu-render-manager.ts` 失败路径时, 若新增事件可被 jsdom mock,
应同步在「失败路径观测」describe 补断言; 若依赖真实 GPU 语义, 更新本段豁免清单。

## Do Not Touch (inherited)

- `dist/` — 构建产物
- `*.test.ts` 中的 mock 数据结构（除非同步更新源文件）
