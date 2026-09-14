## Package: plugins

3DGS 漫游框架插件包：热点系统、相机控制、深度遮挡、触摸手势、场景过渡、
空间媒体嵌入、全屏、加载指示、自动旋转、着色器注入。全部通过
`@3dgs/core` 的 `PluginSystem` 挂载到 `TourPlayer`。

## Risk Files (from root AGENTS.md)

- `src/hotspot/hotspot-manager.ts` (485 lines) — 热点系统核心, churn 521 (最高)
- `src/media-embed/index.ts` (438 lines) — 空间媒体嵌入 (图像/视频)
- `src/scene-transition/index.ts` (296 lines) — 场景过渡动画状态机

## Edit Boundaries

### hotspot/ 职责边界

- `hotspot-manager.ts` — 热点实例管理: 创建/删除/显隐/命中检测/事件分发
- `hotspot-config.ts` — 配置类型 (HotspotConfig/HotspotStyle/HotspotAction...)
- `index.ts` — `createHotspotSystem` 工厂, 挂载到 PluginSystem

**修改时检查**:
- `pnpm test` — 确保 `hotspot-manager.test.ts` 通过
- 与 `@3dgs/core` 的 `extensions` 扩展点协议一致 (v4.1 移除 hotspots 字段后)
- 命中检测边界: 快速移动、重叠热点、深度遮挡组合

### media-embed/ 职责边界

- `index.ts` — 媒体嵌入插件: 图片/视频 DOM 管理、比例/遮挡控制
- `camera-extract.ts` — 相机位姿提取 (从渲染器相机到媒体锚点)

**修改时检查**:
- `pnpm test` — 确保 `camera-extract.test.ts` 通过
- 真实浏览器行为: 用 `e2e/render-smoke.ts` 环境验证 DOM 挂载

### scene-transition/ 职责边界

- `index.ts` — 过渡动画: fade / fly / instant 三种模式
- 与 `@3dgs/core` 的 `SceneTransition` 类型对齐

**修改时检查**:
- `pnpm test` — 确保 `scene-transition.test.ts` 通过
- 动画边界: 快速连续切换、transition 中 destroy

### 其余插件 (单文件)

- `auto-rotate/index.ts` — 自动旋转 (214 lines)
- `camera-controls/index.ts` — 相机控制插件: 触摸/拖拽/缩放 (158 lines)
- `depth-occlusion/index.ts` — 深度遮挡检测: 热点半透明 (191 lines)
- `fullscreen/index.ts` — 全屏切换 (110 lines)
- `loading-indicator/index.ts` — 加载指示器 (198 lines)
- `shader-injection/index.ts` + `presets.ts` — 着色器注入与预设 (114+155 lines)
- `touch-gestures/index.ts` — 多指触摸手势: 捏合/双指旋转/惯性 (283 lines)

**修改时检查**:
- 各插件自带 `*.test.ts` 的跑对应测试
- 插件接口 (mount/unmount/update/dispose) 与 `plugin-system.ts` 契约一致
- 触摸/手势类插件需在真实浏览器验证 (jsdom 不覆盖 PointerEvent 完整语义)

## Cross-File Dependencies

| 风险文件 | 关联文件 | 检查点 |
|---------|---------|--------|
| `hotspot/hotspot-manager.ts` | `hotspot/hotspot-config.ts`, `@3dgs/core` plugin-system | 配置/事件协议 |
| `media-embed/index.ts` | `media-embed/camera-extract.ts` | 相机锚点一致性 |
| `scene-transition/index.ts` | `@3dgs/core` tour-config (SceneTransition) | 类型对齐 |
| `shader-injection/presets.ts` | `shader-injection/index.ts`, renderer-three shader 注入 | WGSL/GLSL 预设 |
| `index.ts` | 全部子插件 | 导出清单 (新增插件需在此注册) |

## Validation Commands

```sh
# plugins 包完整验证
pnpm test -- packages/plugins

# 受影响测试文件 (单文件)
pnpm exec vitest related packages/plugins/src/hotspot/hotspot-manager.ts

# 类型 (插件接口变更影响 core 契约)
pnpm typecheck
```

## Regression Hotspots

以下组合曾频繁出现回归，修改时需额外注意：

- `hotspot-manager.ts` + `hotspot-config.ts` — 配置类型变更全局影响
- `scene-transition/index.ts` + core `SceneTransition` — 类型漂移
- `camera-controls.ts` + `touch-gestures.ts` — 手势冲突
- `depth-occlusion.ts` + `hotspot-manager.ts` — 遮挡与命中检测组合
- `index.ts` 导出变更 + 所有消费方 (demo/docs) — 导出清单破坏

## Do Not Touch (inherited)

- `dist/`, `coverage/`, `.changeset/` — 构建产物与工具管理
- 包发布版本由 changesets 管理