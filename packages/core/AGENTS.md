## Package: core

3DGS 漫游框架核心基础设施：场景数据配置、渲染器抽象、漫游播放器与插件系统。
本包不依赖任何渲染后端（Three.js / WebGL / WebGPU），通过 `RendererAdapter`
接口与具体渲染器解耦。

## Risk Files (from root AGENTS.md)

- `src/tour-player.ts` (238 lines) — 漫游播放器核心状态机
- `src/scene-manager.ts` (198 lines) — 游程状态机 + 场景生命周期

## Edit Boundaries

### tour-player.ts 职责边界

- `TourPlayer` 生命周期: `create` → `load` → `play` → `pause` → `destroy`
- 通过 `RendererAdapter` 与渲染后端交互, **不直接依赖 Three.js/WebGL/WebGPU**
- 通过 `PluginSystem` 编排插件 (v4.1 移除 HotspotManager 硬编码)

**修改时检查**:
- `pnpm test` — 确保 `scene-manager.test.ts`（经它驱动状态机）通过
- `pnpm typecheck`
- 手动验证: 用 renderer-three 的 demo (`apps/demo`) 跑通一次完整播放

### scene-manager.ts 职责边界

- `SceneLoadState` 状态机: `unloaded → loading → loaded → error`
- 场景切换 (`SceneTransition` 配合)、加载状态追踪
- 与 `tour-player.ts` 的加载编排接口

**修改时检查**:
- `pnpm test` — 确保 `scene-manager.test.ts` 通过
- 边界情况: 重复加载、加载中切换、加载失败恢复

### tour-config.ts 职责边界

- 声明式场景图配置格式 (对标 Krpano XML): `TourConfig` / `TourDefaults` /
  `SceneConfig` / `SceneTransition` / `TourMeta`
- v4.1 移除 hotspots 字段, 改用通用 `extensions` 扩展点
- `validateTourConfig` 校验逻辑

**修改时检查**:
- `pnpm test` — 确保 `tour-config.test.ts` 通过
- 配置格式变更需同步更新 `apps/demo` 与 `docs/site` 示例

### tour-loader.ts 职责边界

- 配置加载: JSON 校验 → 场景资源 URL 解析 → `TourRuntime` 组装
- 依赖 `tour-config.ts` 校验与 `scene-manager.ts` 状态机

**修改时检查**:
- `pnpm test` — 确保 `tour-loader.test.ts` 通过

### plugin-system.ts 职责边界

- `PluginSystem`: 插件注册/卸载/生命周期编排/每帧更新
- `TourPlugin` 接口定义 (hotspots 等由 plugins 包实现)
- 与 `tour-player.ts` 的挂载点协议

**修改时检查**:
- `pnpm test` — 确保 `plugin-system.test.ts` 通过
- 生命周期事件: `mount` / `unmount` / `update` / `dispose` 顺序

### renderer-adapter.ts 职责边界

- `RendererAdapter` 抽象接口: 把 `TourPlayer` 与具体渲染后端解耦
- **任何新增渲染器能力 (如新的回调事件) 必须同步更新该接口**
- 实现方: `@3dgs/renderer-three` (createRenderer)

**修改时检查**:
- `pnpm typecheck` — 接口变更影响所有实现方, 必须全仓验证
- `pnpm test` — `@3dgs/renderer-three` 与 `@3dgs/plugins` 的适配测试
- `pnpm --filter @3dgs/renderer-three exec tsc --noEmit`

## Cross-File Dependencies

| 风险文件 | 关联文件 | 检查点 |
|---------|---------|--------|
| `tour-player.ts` | `scene-manager.ts`, `plugin-system.ts`, `renderer-adapter.ts` | 生命周期编排 |
| `scene-manager.ts` | `tour-config.ts`, `renderer-adapter.ts` | 状态机与加载 |
| `tour-loader.ts` | `tour-config.ts`, `scene-manager.ts` | 配置 → 运行时 |
| `renderer-adapter.ts` | 全部 (接口契约) | 渲染后端解耦边界 |
| `tour-config.ts` | `tour-loader.ts`, `docs/site` 示例 | 配置格式一致性 |

## Validation Commands

```sh
# core 包完整验证
pnpm test -- packages/core

# 受影响测试文件 (单文件)
pnpm exec vitest related packages/core/src/scene-manager.ts

# 类型 (含跨包: 接口变更影响 renderer-three/plugins)
pnpm typecheck
```

## Regression Hotspots

以下组合曾频繁出现回归，修改时需额外注意：

- `tour-player.ts` + `scene-manager.ts` — 生命周期状态机变更
- `tour-config.ts` 格式变更 + 所有消费方 (demo/loader/docs) — 字段删除/重命名全局影响
- `renderer-adapter.ts` 接口变更 + renderer-three 实现 — 跨包契约破坏
- `plugin-system.ts` 生命周期变更 + plugins 包 — 插件挂载/卸载顺序

## Do Not Touch (inherited)

- `dist/`, `coverage/`, `.changeset/` — 构建产物与工具管理
- 包发布版本由 changesets 管理