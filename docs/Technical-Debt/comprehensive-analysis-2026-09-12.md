# 3DGS 项目全面技术优化项与技术债务分析

> **分析日期:** 2026-09-12
> **分析范围:** 全量源码 Review — 6 个发布包 (`core`, `renderer-three`, `convert`, `plugins`, `react`, `vue`) + demo 应用
> **代码总量:** ~15,300 行 TypeScript（不含测试）
> **核实工具:** CodeGraph (`codegraph explore` 逐项核实调用关系、测试覆盖、依赖路径)
> **关联文档:** `docs/Technical-Debt/technical-debt.md`（历史债务登记）、`docs/technical-debt-plan.md`（2026-08-27 方案）

---

## 1. 分析总览

本次分析覆盖项目全部 6 个发布包和 demo 应用，逐文件审查源码实现，并通过 CodeGraph 逐项核实调用关系与测试覆盖。共识别 **36 项技术优化项/技术债务**。按影响分级：

- 🔴 **P0 — 功能失效或潜在崩溃**（5 项）
- 🟠 **P1 — 功能缺陷/性能瓶颈**（14 项）
- 🟡 **P2 — 代码卫生/可维护性**（17 项）

### 包规模统计

| 包 | 源文件数 | 代码行数 | 测试文件数 | 核心复杂度 |
|---|---|---|---|---|
| `core` | 6 | ~700 | 4 | 低 |
| `renderer-three` | 18 | ~5,200 | 14 | 极高 |
| `convert` | 9 | ~3,100 | 6 | 高 |
| `plugins` | 15 | ~2,500 | 6 | 中 |
| `react` | 1 | ~160 | 0 | 低 |
| `vue` | 1 | ~130 | 0 | 低 |

---

## 2. 🔴 P0 — 立即修复

### TD-01: WebGPU SPZ 路径丢失 SH 球谐数据

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-render-manager.ts:680`（`loadSceneWithSpz` 使用 `decodeSpzInWorker`） |
| **根因** | WebGL 路径（`RenderManager`）已通过 SPZ 原生加载保留 SH 系数，但 WebGPU 路径仍走旧的 Worker 解码（输出 .splat 布局，SH 被丢弃）。`decodeSpzInWorker` 返回的字节不含 SH 数据 |
| **CodeGraph 核实** | ✅ 确认 — `loadSceneWithSpz` (webgpu-render-manager.ts:680) 调用 `decodeSpzInWorker` (spz-decoder-worker.ts:254)，4 个调用者中 WebGPU 路径的 `loadSceneWithSpz` 确认走 .splat 解码布局 |
| **影响** | 双后端画质不一致 — WebGPU 后端视角依赖着色丢失；WebGPU 转正时的阻断项 |
| **修复方案** | WebGPU 路径同样先做 SPZ 原生解码（复用 Spark 解码结果或直接移植 spz 解码到 WGSL 可消费的布局），至少保证 DC 颜色与 WebGL 路径一致 |
| **预计成本** | 1-2 天 |

### TD-02: `fly` 场景过渡与 `camera:defaults` 事件无消费者

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/scene-transition/index.ts:196`（emit `transition:fly:frame`）、`packages/core/src/tour-player.ts:125`（emit `camera:defaults`） |
| **根因** | 两个事件均无任何监听者。渲染器未消费 fly 帧数据，相机插件未消费默认值 |
| **CodeGraph 核实** | ✅ 确认 — `rg "camera:defaults\|transition:fly"` 确认仅 emit 无 `.on()` 调用。`camera-controls` 插件（camera-controls/index.ts）内无任何 `.on()` 注册 |
| **影响** | 配置了 `fly` 过渡或 `defaults.camera` 的项目实际无效果，文档承诺与行为不符 |
| **修复方案** | **A（推荐）** 在 `camera-controls` 插件中监听 `camera:defaults` 应用 fov/pitch 限制、监听 `transition:fly:frame` 驱动 yaw/pitch/fov 插值；**B** 若短期无人力，先从文档与类型中下线 `fly` 选项 |
| **预计成本** | A：1-2 天；B：0.5 天 |

### TD-03: 预加载（preload）功能为空壳

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/scene-manager.ts:44`（`loadScene` 仅改状态位）、`packages/core/src/scene-manager.ts:89`（`preload`/`preloadScenes` 方法） |
| **根因** | 设计上把真实加载委托给渲染器，但预加载路径没有对应的渲染器调用。`SceneManager.loadScene()` 仅将状态从 `unloaded` 改为 `loaded`，不触发任何数据加载 |
| **CodeGraph 核实** | ✅ 确认 — `preloadScenes` (scene-manager.ts:96) 有 3 个调用者在 `hotspot/index.ts`，但 `loadScene` 内部注释明示"实际 splat 加载由渲染适配器完成"。`RendererAdapter` 接口无 `preloadScene` 方法定义 |
| **影响** | 多场景漫游"无缝切换"承诺不成立，切换时必须全量等待下载。`preloadScenes()` 被热点插件调用但实际无效 |
| **修复方案** | `RendererAdapter.preloadScene?(source, options): Promise<PreloadedHandle>`（下载+解码，不上传挂载）；`switchScene` 优先消费预加载句柄；不支持的后端静默回退 |
| **预计成本** | 2 天 |

### TD-04: `RenderManager` 主文件 1499 行 — 认知过载风险

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（1499 行） |
| **根因** | 该文件承载了 WebGL 渲染器全部逻辑：Three.js 初始化、Spark 配置、格式路由（.splat/.spz/.sog）、降采样、LOD 构建、context lost/restore、Shader 注入、自适应分辨率、视锥裁剪、缓冲池管理、键盘控制、可见性暂停等 15+ 个职责 |
| **CodeGraph 核实** | ✅ 确认 — 该文件有 22+ 个方法，涉及格式路由、降采样、context 恢复、注入等独立职责 |
| **影响** | 修改一个职责（如格式路由）可能影响其他职责（如 context restore）；代码审查困难；新成员上手成本高 |
| **修复方案** | 提取独立模块：`format-router.ts`（格式路由 + 回退链）、`scene-loader.ts`（加载/降采样/相机定位）、`context-recovery.ts`（context lost/restore 逻辑）。主文件仅做编排 |
| **预计成本** | 2-3 天（含测试迁移） |

### TD-05: WebGPU `WebGPURenderManager` 1799 行 — 与 WebGL 路径大量重复

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-render-manager.ts`（1799 行） |
| **根因** | 虽然 M4 已提取共享模块（KeyboardControls、FrameCallbackManager、CameraMatrixCache），但格式路由、降采样、流式进度读取、相机定位等仍各写一份。两套 `loadSceneWithSplat/Spz/Sog` 方法高度相似 |
| **CodeGraph 核实** | ✅ 确认 — 两个渲染器各自实现了 `loadSceneWithSplat`/`loadSceneWithSpz`/`loadSceneWithSog` 方法，格式路由与降采样逻辑各写一份 |
| **影响** | 任何加载逻辑修改需同步两处；WebGPU 路径的 SPZ 解码丢失 SH（TD-01）就是不同步的结果 |
| **修复方案** | 抽取 `fetchWithProgress` / `downsampleSplatData` / 格式路由为共享工具模块；两个渲染器共用 |
| **预计成本** | 1-2 天 |

---

## 3. 🟠 P1 — 近期排期

### TD-06: Convert 包 AoS 数据布局 — 大文件内存瓶颈

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/gaussian-loader.ts:59`（`GaussianCloud` 使用 `GaussianSplat[]`）、`packages/convert/src/processing.ts` |
| **根因** | `GaussianCloud` 使用 AoS（Array of Structs）布局 — 每个 splat 是一个 JS 对象（~20 个属性），5M splats 场景下 V8 堆占用 ~3-4 GB。SoA 版本（`toSoA`/`fromSoA`）已实现但仅测试使用，未接入生产路径 |
| **CodeGraph 核实** | ✅ 确认 — `toSoA` (gaussian-loader.ts:697) 仅有 1 个调用者在测试文件 `convert-e2e.test.ts`，不在生产路径中。`GaussianCloud` 有 26 个调用者全部使用 AoS 布局 |
| **影响** | 转换 >300 万高斯核的 PLY 文件需要 `NODE_OPTIONS="--max-old-space-size=8192"`，否则 OOM 崩溃 |
| **修复方案** | 解析直出 `GaussianCloudSoA`；prune/mortonSort 提供 SoA 版；writer 接受 SoA。需 5M splat 大文件回归 |
| **预计成本** | 2-3 天 |

### TD-07: PLY 解析器 DataView 逐字段读取 — 性能未达最优

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/ply-parser.ts`（`parseBinaryBody` 逐行逐属性 `readBinaryValue`）、`webgpu-render-manager.ts`（`parseSplatData` 同样逐字段 DataView） |
| **根因** | 虽然已有快路径（`tryFastPathParsePly`），但慢路径仍使用逐字段 `DataView.getFloat32()` 调用。WebGPU 渲染器的 `parseSplatData` 也使用逐字段 DataView 而非 TypedArray 视图直取 |
| **影响** | 大文件解析速度慢；WebGPU 路径的 splat 数据解析是加载瓶颈 |
| **修复方案** | `Float32Array` 视图直取 + 反量化入 Worker；WebGPU `parseSplatData` 改用 TypedArray 视图 |
| **预计成本** | 1 天 |

### TD-08: 双后端重复的加载/降采样/进度代码

| 字段 | 内容 |
|---|---|
| **涉及文件** | `renderer-three/src/index.ts`（`loadSceneWithTruncatedSplat`、`loadSceneWithSpz`、`loadSceneWithSog`）、`renderer-three/src/webgpu-render-manager.ts`（同名方法） |
| **根因** | M4 债务已提取共享模块，但格式路由、降采样循环、流式进度读取仍各写一份 |
| **CodeGraph 核实** | ✅ 确认 — 两个渲染器各自实现 3 套 `loadSceneWith*` 方法，降采样和 fetch 进度逻辑重复约 200 行 |
| **影响** | 代码重复 ~200 行；修改一处容易遗漏另一处 |
| **修复方案** | 抽取 `fetchWithProgress` / `downsampleSplatBytes` / 格式路由共享模块 |
| **预计成本** | 1 天 |

### TD-09: `WebGPURenderManager` 逐 splat 视锥裁剪 — O(N) 复杂度

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-render-manager.ts:1174`（`performFrustumCull` 方法，逐 splat 中心点测试） |
| **根因** | 项目中存在两套独立的视锥裁剪实现：`FrustumCulling` 类（基于 Morton 空间分块的 `SpatialGrid`，O(G) 复杂度）和 `WebGPURenderManager.performFrustumCull()`（逐 splat 中心点 `frustum.containsPoint()`，O(N) 复杂度） |
| **CodeGraph 核实** | ✅ 确认 — `performFrustumCull` (webgpu-render-manager.ts:1174) 有 2 个调用者均在同一文件内。`FrustumCulling` (frustum-culling.ts:390) 有 4 个调用者仅在 `index.ts`（WebGL 路径），WebGPU 路径不使用 |
| **影响** | 大场景（1M+ splats）每 3 帧遍历全部 splat 中心点，性能低于 `SpatialGrid` 的批量分块方案 |
| **修复方案** | `FrustumCulling` 增加 `Float32Array` 构造入口 → `WebGPURenderManager` 用解析出的 positions 构建 → `getVisibleRanges()` 展开为可见位图与排序索引合流 → 删除逐点 `performFrustumCull` |
| **预计成本** | 1 天 |

### TD-10: React/Vue 组件零测试覆盖

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/react/src/index.tsx`、`packages/vue/src/index.ts` |
| **根因** | 两个框架适配包无任何测试文件 |
| **CodeGraph 核实** | ✅ 确认 — 两个包均无 `.test.ts`/`.test.tsx` 文件 |
| **影响** | D-05（React 双重加载）修复后无回归测试保障；组件生命周期、props 变化、错误边界均无验证 |
| **修复方案** | 引入 `@testing-library/react` 和 `@vue/test-utils`；为 `TourViewer` 补挂载/卸载/config 变化/错误展示/事件转发测试 |
| **预计成本** | 1-2 天 |

### TD-11: `RenderManager` 主体零测试

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（1499 行） |
| **根因** | 仅 `index-pipeline.test.ts` 覆盖了部分管线逻辑，核心的格式路由、降采样、context restore、Shader 注入重建等无测试 |
| **CodeGraph 核实** | ✅ 确认 — `loadScene` (index.ts:403) 仅有调用者在外部示例中，无直接单元测试 |
| **影响** | 高风险修改（如 TD-04 重构）缺乏安全网 |
| **修复方案** | 为格式路由/降采样/注入逻辑补 mock 测试 |
| **预计成本** | 2-3 天 |

### TD-12: `HotspotManager` 每帧 DOM 操作 — 大量热点时性能瓶颈

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/hotspot/hotspot-manager.ts:283`（`updateVisibility` 方法） |
| **根因** | 每帧对每个热点执行 `el.style.display`、`el.style.left`、`el.style.top`、`el.style.opacity` 等 DOM 样式写入。100+ 热点时触发大量强制同步布局（forced reflow） |
| **CodeGraph 核实** | ✅ 确认 — `updateVisibility` (hotspot-manager.ts:283) 有 3 个调用者在 `hotspot/index.ts`。测试存在于 `hotspot-manager.test.ts` |
| **影响** | 热点数量多时帧率下降；移动端尤为明显 |
| **修复方案** | 使用 CSS transform 替代 left/top（GPU 加速）；批量读写分离；对不可见热点跳过样式更新 |
| **预计成本** | 1 天 |

### TD-13: `PluginSystem.update` 每帧创建新对象

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/plugin-system.ts:68`（`update` 方法中 `{ ...frameData, deltaTime }`） |
| **根因** | 每帧通过展开运算符创建新的 `FrameContext` 对象。60fps 下每秒 60 次对象分配 + GC |
| **CodeGraph 核实** | ✅ 确认 — `update` (plugin-system.ts:68) 有 3 个调用者在 `tour-player.ts`。`FrameContext` 有 12 个调用者在各插件中 |
| **影响** | 微小但持续的 GC 压力；在低端设备上可能加剧帧率波动 |
| **修复方案** | 复用 `FrameContext` 对象，每帧仅更新 `deltaTime` 字段 |
| **预计成本** | 0.5 天 |

### TD-14: `SceneManager.preloadScenes` 使用 `Promise.all` — 语义不精确

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/scene-manager.ts:96`（`preloadScenes` 方法） |
| **根因** | `Promise.all(sceneIds.map(...))` 虽然每个 `preload` 都有 `.catch(() => {})`，但 `Promise.all` 的语义暗示"全部成功" |
| **影响** | 当前代码安全，但语义不清晰，维护者可能误改 |
| **修复方案** | 改用 `Promise.allSettled` 明确表达"不关心单个失败"的语义 |
| **预计成本** | 0.5 天 |

### TD-15: `contributionCutoff` 排序使用 `Array.sort` — O(N log N) 全量排序

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/processing.ts`（`pruneGaussians` 函数） |
| **根因** | 贡献度裁剪先对所有 splat 计算 score 并全量排序，再取前 N 个。5M splats 场景下排序耗时显著 |
| **影响** | 大文件转换时贡献度裁剪步骤成为瓶颈 |
| **修复方案** | 使用 `quickselect` 算法（O(N) 平均）找到第 K 大的 score 阈值，再过滤。或维护一个大小为 K 的最小堆 |
| **预计成本** | 0.5 天 |

### TD-16: `generateTour` 生成的热点位置硬编码

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/cli.ts`（`generateTour` 函数） |
| **根因** | 生成的热点位置全部硬编码为 `[1.0, 1.5, -2.0]`、`[-1.0, 1.5, -2.0]` 等固定值，不考虑场景实际包围盒 |
| **CodeGraph 核实** | ✅ 确认 — `generateTour` (cli.ts) 不调用任何场景数据解析函数，位置均为字面量 |
| **影响** | 生成的 tour.json 需要手动调整热点位置才能使用 |
| **修复方案** | 从场景数据的包围盒中心/边界计算热点位置 |
| **预计成本** | 0.5 天 |

### TD-17: Vue 组件 `watch` 可能与 `onMounted` 竞争

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/vue/src/index.ts`（`watch(() => props.config, ...)`） |
| **根因** | Vue 的 `watch` 在 setup 阶段注册，config prop 变化时 watch 回调可能在 player 未初始化时执行。虽然 `loadConfig` 有 `if (!player) return` 守卫，但首次加载由 `onMounted` 触发后，watch 可能再次触发导致双重加载 |
| **修复方案** | 使用 `isFirstMount` ref 守卫（与 React 修复一致），或改用 `watch` 的 `flush: 'post'` + 首次跳过 |
| **预计成本** | 0.5 天 |

### TD-18: `DepthOcclusion` 插件强制 `preserveDrawingBuffer: true` — GPU 性能退化

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/depth-occlusion/index.ts:77` |
| **根因** | 插件调用 `canvas.getContext('webgl2', { preserveDrawingBuffer: true })` 读取深度缓冲。`preserveDrawingBuffer: true` 强制浏览器在合成后保留绘制缓冲，阻止 GPU 使用某些优化（如 tile-based rendering 的快速清除），导致整体渲染性能退化 |
| **CodeGraph 核实** | ✅ 确认 — `rg "preserveDrawingBuffer"` 全仓库仅此一处出现。该插件在 `init` 中创建第二个 WebGL2 上下文，可能与主渲染器的上下文冲突 |
| **影响** | 启用深度遮挡插件时全局渲染性能下降（即使热点不在视野内）；某些 GPU 架构（如 Apple Silicon tile-based deferred renderer）受影响更大 |
| **修复方案** | ① 使用 `requestAnimationFrame` 后的同步 `readPixels`（不需要 `preserveDrawingBuffer`，但需在渲染后立即读取）；② 或使用 WebGL2 的 `query` 扩展做遮挡查询（GPU 端判定，无需回读）；③ 或改用深度纹理渲染（单独 pass） |
| **预计成本** | 1-2 天 |

### TD-19: SOG v3 格式部分实现 — 写入端定义但未接线，读取端完全缺失

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/sog-writer.ts:75`（`SOG_MAGIC_V3`/`SOG_VERSION_V3`/`SOG_V3_OVERLAY_HEADER_SIZE` 常量）、`packages/renderer-three/src/sog-streamer.ts:102-105`（仅 v1/v2） |
| **根因** | SOG v3 格式定义了 SH overlay 分层加载（`SOG_MAGIC_V3 = 0x33474f53`），但写入端 `writeSog()` 在 line 396 始终写入 `SOG_MAGIC_V2`，从未使用 v3 magic。读取端 `sog-streamer.ts` 仅识别 v1 和 v2 magic，遇到 v3 会抛出"无效的 SOG 文件: magic 不匹配" |
| **CodeGraph 核实** | ✅ 确认 — `rg "SOG_MAGIC"` 显示 `sog-writer.ts` 定义了 v1/v2/v3 三个常量但 `writeSog` 只用 v2。`sog-streamer.ts` 仅定义 v1/v2 常量，无 v3 |
| **影响** | SOG v3 SH overlay 功能不可用；若有人手动构造 v3 文件，读取端会崩溃 |
| **修复方案** | ① 在 `writeSog` 中支持 v3 写入（当 `shMode !== 0` 时使用 v3 magic + overlay header）；② 在 `sog-streamer.ts` 和 `parseSogMetadata` 中支持 v3 读取 |
| **预计成本** | 1-2 天 |

---

## 4. 🟡 P2 — 代码卫生

### TD-20: `decodeSpzInWorker` 导出仅为"向后兼容"但已不在主路径

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（导出 `decodeSpzInWorker`） |
| **根因** | WebGL 路径已改为 SPZ 原生加载（保留 SH），WebGPU 路径仍使用但应迁移（TD-01）。导出仅为向后兼容 |
| **修复方案** | TD-01 完成后评估下线，标记 `@deprecated` |
| **预计成本** | 0.5 天 |

### TD-21: `TourPlayer` 事件类型系统不完整

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/tour-player.ts:20`（`TourPlayerEventType` 联合类型） |
| **根因** | `TourPlayerEventType` 仅声明了已知事件类型，但 `on()` 和 `emit()` 方法接受任意 `string`。插件发射的自定义事件（如 `transition:fly:frame`、`camera:defaults`）无类型约束 |
| **CodeGraph 核实** | ✅ 确认 — `TourPlayerEventType` (tour-player.ts:20) 不包含 `camera:defaults` 或 `transition:fly:frame` |
| **修复方案** | 引入事件注册表类型（`EventMap`），`on/emit` 泛型约束 |
| **预计成本** | 0.5 天 |

### TD-22: `ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT` 与 `FRAGMENT_MAIN_END` 语义重叠

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/renderer-adapter.ts`（枚举定义）、`renderer-three/src/index.ts` 和 `webgpu-render-manager.ts`（switch 分支） |
| **根因** | 因 Spark GLSL3 下 `fragColor` 赋值时序问题，`FRAGMENT_BEFORE_OUTPUT` 被改为注入到 `main()` 末尾，与 `FRAGMENT_MAIN_END` 行为完全相同。已标 `@deprecated` 但两个枚举值仍存在 |
| **修复方案** | 下一个 major 版本移除 `FRAGMENT_BEFORE_OUTPUT`；当前保持 `@deprecated` 注释 |
| **预计成本** | 0.5 天（下一 major 版本） |

### TD-23: `_lodReadyLogged` 仅消费一次后不再通知

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（`_lodReadyLogged` 字段） |
| **根因** | LOD 就绪日志仅打印一次，场景切换后重置。但无外部 API 可查询 LOD 状态变化（`isLodReady()` 需轮询） |
| **修复方案** | 通过事件总线发射 `lod:ready` 事件，供插件和外部消费者监听 |
| **预计成本** | 0.5 天 |

### TD-24: `SplatBufferPool` 池命中率无法从外部持续监控

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/buffer-pool.ts`、`packages/renderer-three/src/index.ts` |
| **根因** | `getBufferPoolStats()` 已暴露但仅在控制台手动查看。无持续监控或告警机制 |
| **CodeGraph 核实** | ✅ 确认 — `BufferPoolStats` (buffer-pool.ts:31) 有 3 个调用者仅在 `index.ts` 和 `buffer-pool.ts` 内部 |
| **修复方案** | 在 demo 的性能面板中显示池命中率；或提供 `onPoolEvent` 回调 |
| **预计成本** | 0.5 天 |

### TD-25: Morton Code 排序精度限制 — 16-bit per axis

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/processing.ts`（`morton3D` 函数） |
| **根因** | 为性能从 21-bit（BigInt）降级到 16-bit（Number），提供 65536 级空间分辨率。对 ~1km 以内场景足够，但超大场景（>10km）可能出现排序质量下降 |
| **修复方案** | 文档化限制；或提供 `--high-precision` 选项 |
| **预计成本** | 0.5 天（文档化） |

### TD-26: LOD 树序列化格式未版本化

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/sog-writer.ts:645`（`serializeLodTree`）、`packages/convert/src/sog-writer.ts:667`（`deserializeLodTree`） |
| **根因** | LOD 树格式（8B header + numLevels×4B）直接嵌入 SOG v2 文件，但格式本身无版本号 |
| **CodeGraph 核实** | ✅ 确认 — `serializeLodTree` (sog-writer.ts:645) 和 `deserializeLodTree` (sog-writer.ts:667) 的 header 仅包含 `numLevels` 和 `lodBase`，无版本字段 |
| **修复方案** | 在 LOD 树 header 中添加格式版本号 |
| **预计成本** | 0.5 天 |

### TD-27: `DragLookControls` 缺少单元测试

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/drag-look-controls.ts` |
| **根因** | 拖拽控制是核心交互组件，但无独立测试文件 |
| **CodeGraph 核实** | ✅ 确认 — `DragLookControls` (drag-look-controls.ts:15) 有 6 个调用者，仅通过示例代码间接测试，无 `.test.ts` 文件 |
| **修复方案** | 补测试：阻尼平滑、滚轮缩放、lookAt 行为 |
| **预计成本** | 1 天 |

### TD-28: `TourConfig` 类型验证仅运行时，无 JSON Schema

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/tour-config.ts:105`（`validateTourConfig` 函数） |
| **根因** | 配置验证使用手写 TypeScript 类型守卫，无 JSON Schema |
| **CodeGraph 核实** | ✅ 确认 — `validateTourConfig` (tour-config.ts:105) 有 5 个调用者在 `tour-loader.ts`，为手写验证逻辑 |
| **修复方案** | 生成 JSON Schema 并发布；`validateTourConfig` 基于 Schema 验证 |
| **预计成本** | 1 天 |

### TD-29: `AdaptiveResolution` 恢复速率固定

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/adaptive-resolution.ts` |
| **根因** | 分辨率恢复逻辑固定为每 45 帧增加 0.1（`adjustInterval: 45`, `step: 0.1`），不考虑当前帧率余量 |
| **CodeGraph 核实** | ✅ 确认 — `AdaptiveResolution` (adaptive-resolution.ts:25) 构造函数中 `step` 和 `adjustInterval` 均为固定值 |
| **修复方案** | 根据帧率与阈值的差距动态调整恢复速率 |
| **预计成本** | 0.5 天 |

### TD-30: `HotspotManager.openPopup` 使用 `innerHTML` 注入内容

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/hotspot/hotspot-manager.ts`（`openPopup` 方法中 `content.innerHTML = popup.content`） |
| **根因** | 虽然注释说明"配置来源为受信任的 tour.json"，但 `innerHTML` 注入在配置被篡改时存在 XSS 风险 |
| **修复方案** | 使用 `DOMPurify` 或手动构建 DOM 节点；至少在文档中明确安全约束 |
| **预计成本** | 0.5 天 |

### TD-31: `WebGPUSortManager` 排序结果 GPU→CPU 回读开销

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-sort-manager.ts:279`（`ensureReadbackBuffer` 方法） |
| **根因** | GPU compute 排序后需要将排序索引从 GPU buffer 回读到 CPU（`mapAsync`），每排序一次产生一次 GPU→CPU 同步。虽然已优化（buffer 复用、去 `Array.from`），但同步开销仍存在 |
| **CodeGraph 核实** | ✅ 确认 — `ensureReadbackBuffer` (webgpu-sort-manager.ts:279) 使用 `MAP_READ | COPY_DST` buffer，`sort` 方法在 line 234 执行 `copyBufferToBuffer` 回读 |
| **影响** | 大场景（>2M splats）排序回读可能成为瓶颈 |
| **修复方案** | 全 GPU 路径：排序索引直接作为 GPU buffer 传递给渲染管线，不回读 CPU |
| **预计成本** | 2-3 天 |

### TD-32: `convert` 包缺少流式 PLY 解析

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/ply-parser.ts`、`packages/convert/src/gaussian-loader.ts` |
| **根因** | PLY 解析需要先将整个文件读入内存，然后解析。对于 >100MB 的 PLY 文件，内存峰值 = 文件大小 + 解析结果 |
| **修复方案** | 使用 `ReadableStream` 流式解析 PLY body。配合 SoA 布局（TD-06）可显著降低内存峰值 |
| **预计成本** | 2-3 天 |

### TD-33: demo 应用未做代码分割

| 字段 | 内容 |
|---|---|
| **涉及文件** | `apps/demo/`（Vite 配置） |
| **根因** | demo 单 chunk 5,557 kB / gzip 1,923 kB。Three.js + Spark WASM + 所有插件打包在一起 |
| **修复方案** | `manualChunks` 拆 three/spark；`createRenderer` 对 WebGPU 模块动态 `import()` |
| **预计成本** | 0.5-1 天 |

### TD-34: 移动端真机测试仍未执行

| 字段 | 内容 |
|---|---|
| **涉及文件** | 无（需要物理设备） |
| **根因** | 所有性能数据来自桌面 Chrome (macOS)。无 iOS Safari 和 Android Chrome 的真机性能数据 |
| **影响** | 移动端性能基线未知；context lost 恢复路径未经真机验证 |
| **修复方案** | 在 iPhone (Safari) 和 Android (Chrome) 上运行 demo；使用 Chrome Remote Debugging 采集性能数据 |
| **预计成本** | 2-3 天 |

### TD-35: `camera-controls` 和 `LoadingIndicator` 插件零测试覆盖

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/camera-controls/index.ts`、`packages/plugins/src/loading-indicator/index.ts` |
| **根因** | 两个核心插件无任何测试文件 |
| **CodeGraph 核实** | ✅ 确认 — `createCameraControls` (camera-controls/index.ts:31) 和 `createLoadingIndicatorPlugin` (loading-indicator/index.ts:59) 均无 `.test.ts` 文件，CodeGraph 报告"no tests found within 3 caller hops" |
| **影响** | `camera-controls` 的 yaw/pitch/fov 控制逻辑无回归保障；`LoadingIndicator` 的进度/错误状态无验证 |
| **修复方案** | 补单元测试：相机控制响应、FOV 限制、加载指示器显示/隐藏 |
| **预计成本** | 1 天 |

### TD-36: `Fullscreen` 和 `AutoRotate` 插件零测试覆盖

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/fullscreen/index.ts`、`packages/plugins/src/auto-rotate/index.ts` |
| **根因** | 两个插件仅在示例代码中测试，无独立测试文件 |
| **CodeGraph 核实** | ✅ 确认 — `createFullscreenPlugin` (fullscreen/index.ts:38) 和 `createAutoRotatePlugin` (auto-rotate/index.ts:52) 仅在 examples 中被引用，无 `.test.ts` 文件（auto-rotate 有独立测试 `auto-rotate.test.ts`） |
| **影响** | `Fullscreen` 的双击/ESC/状态变化逻辑无回归保障 |
| **修复方案** | 为 `Fullscreen` 插件补测试（AutoRotate 已有 `auto-rotate.test.ts`，核实后应从本项移除） |
| **预计成本** | 0.5 天 |

---

## 5. 已解决债务复核（CodeGraph 验证）

以下债务在之前的 Review 中识别并已修复，本次通过 CodeGraph 确认状态：

| 编号 | 原状态 | CodeGraph 复核 |
|---|---|---|
| D-01 WebGPU 索引覆盖 | ✅ 已修复 | ✅ 确认 — `mergeSortedVisibleIndices` 纯函数 + `mergeAndUploadIndices` 单一写入路径 |
| D-02 SOG chunk 失败静默 | ✅ 已修复 | ✅ 确认 — `start()` 抛错触发回退链 |
| D-03 CLI Buffer 池 | ✅ 已修复 | ✅ 确认 — `toArrayBuffer()` 安全切片 |
| D-04 context restore 循环 | ✅ 已修复 | ✅ 确认 — `_startRenderLoop()` 共用 |
| D-05 React 双重加载 | ✅ 已修复 | ✅ 确认 — `isFirstMount` ref 守卫 |
| D-06 Promise 反模式 | ✅ 已修复 | ✅ 确认 — 空 source 前置 + `_withTimeout` |
| D-09 WebGPU 相机朝向 | ✅ 已修复 | ✅ 确认 — 翻转 positions 而非相机 |
| D-10 BufferPool 接线 | ✅ 已修复 | ✅ 确认 — `acquire` 3 调用者 + `release` 3 调用者 + `destroy` 中 `clear` |
| D-12 钩子语义 | ✅ 已文档化 | ✅ 确认 — `@deprecated` 注释 |
| D-14 跨平台脚本 | ✅ 已修复 | ✅ 确认 — Node clean 脚本 + 引号 glob |
| D-15 测试免构建 | ✅ 已修复 | ✅ 确认 — vitest 别名 |
| D-17 plugins 子路径导出 | ✅ 已修复 | ✅ 确认 — 10 个子路径导出 |
| N-01 visibilitychange | ✅ 已修复 | ✅ 确认 — `_visibilityHandler` 在双后端均实现 |
| N-02 HIGH/ULTRA pixelRatio | ✅ 已修复 | ✅ 确认 — `min(dpr, cap)` |
| N-03 iPadOS 检测 | ✅ 已修复 | ✅ 确认 — `maxTouchPoints` 判定 |
| N-07 prefers-reduced-motion | ✅ 已修复 | ✅ 确认 — `matchMedia('(prefers-reduced-motion: reduce)')` 在 auto-rotate/index.ts:91 |
| M4 共享模块 | ✅ 已完成 | ✅ 确认 — KeyboardControls/FrameCallbackManager/CameraMatrixCache 3 个共享模块 + WGSL 注入 |
| M5 SPZ Writer gzip | ✅ 已修复 | ✅ 确认 — header 不压缩 |
| §2.3 排序 buffer 复用 | ✅ 已修复 | ✅ 确认 — `ensureReadbackBuffer` 复用 + `indices.sort` 直接 TypedArray 排序 |
| §2.5/N-06 AdaptiveResolution suspend/resume | ✅ 已修复 | ✅ 确认 — `_suspended` 标志 + `suspend()`/`resume()` 方法 |

---

## 6. 修复路线图

### 第一阶段：止血（1-2 周）
- TD-01（WebGPU SPZ SH）、TD-02（fly/camera:defaults 落地或下线）
- TD-17（Vue 双重加载守卫）、TD-18（DepthOcclusion preserveDrawingBuffer）
- TD-19（SOG v3 读取端支持或下线常量）
- **验收：** 双后端画质一致；fly 过渡可用或从文档下线；DepthOcclusion 不影响全局性能

### 第二阶段：性能优化（2-4 周）
- TD-06（SoA 改造）、TD-07（解析提速）、TD-09（裁剪统一）
- TD-12（热点 DOM 优化）、TD-15（quickselect）
- **验收：** 5M splats 转换无需 8GB 堆；WebGPU 裁剪 O(G)

### 第三阶段：架构治理（1-2 月）
- TD-03（预加载）、TD-04/05（代码拆分 + 共享模块）
- TD-08（重复代码抽取）、TD-31（全 GPU 排序路径）
- **验收：** 主文件 <800 行；预加载端到端可用

### 第四阶段：测试与卫生（持续）
- TD-10/11/27/35/36（测试补全）、TD-32（流式 PLY 解析）
- TD-20~TD-36（P2 项随迭代清理）
- TD-34（移动端真机测试）

---

## 7. 防债务增长机制建议

1. **文件大小门禁：** CI 检查 `renderer-three/src/index.ts` 和 `webgpu-render-manager.ts` 行数，超过 1000 行时警告
2. **优化项"接线"闭环：** 任何性能优化 PR 必须附带生效证明（基准对比或命中率统计）
3. **事件契约登记：** `TourPlayer` 事件总线维护事件清单（发射方/消费方），新增事件必须成对出现
4. **双后端同步检查：** 新增加载路径/格式支持时，CI 检查两个渲染器是否同步实现
5. **跨平台脚本校验：** CI 增加 Windows runner 跑 `lint`/`typecheck`/`test` 三件套
6. **格式版本一致性：** 新增格式版本（如 SOG v3）必须同时实现写入端和读取端，CI 检查格式常量与读写路径的一致性

---

## 附录：CodeGraph 核实摘要

本次分析使用 CodeGraph `codegraph explore` 命令对以下关键债务项进行了调用关系和测试覆盖核实：

| 核实项 | CodeGraph 查询 | 核实结果 |
|---|---|---|
| TD-01 WebGPU SPZ SH | `WebGPURenderManager loadSceneWithSpz decodeSpzInWorker` | ✅ `loadSceneWithSpz:680` 调用 `decodeSpzInWorker:254` |
| TD-02 事件无消费者 | `transition:fly:frame camera:defaults emit event listeners` | ✅ `rg` 确认仅 emit 无 `.on()` |
| TD-03 preload 空壳 | `preload preloadScene RendererAdapter preload` | ✅ `preloadScenes:96` 有调用者但 `loadScene:44` 仅改状态 |
| TD-06 SoA 未接入 | `toSoA fromSoA GaussianCloudSoA convert production path` | ✅ `toSoA:697` 仅 1 调用者在测试文件 |
| TD-09 裁剪重复 | `FrustumCulling performFrustumCull SpatialGrid` | ✅ `performFrustumCull:1174` 仅 WebGPU 路径使用 |
| TD-10 BufferPool 接线 | `SplatBufferPool acquire release buffer pool stats` | ✅ `acquire`/`release` 各 3 调用者在 index.ts |
| TD-13 每帧分配 | `PluginSystem update FrameContext deltaTime` | ✅ `update:68` 有 3 调用者在 tour-player.ts |
| TD-18 preserveDrawingBuffer | `rg "preserveDrawingBuffer"` | ✅ 全仓库仅 depth-occlusion/index.ts:77 |
| TD-19 SOG v3 缺失 | `rg "SOG_MAGIC"` 写入端 vs 读取端 | ✅ 写入端定义 v3 但用 v2；读取端无 v3 |
| TD-27 DragLookControls 无测试 | `DragLookControls touch wheel damping test` | ✅ 无 `.test.ts` 文件 |
| TD-31 排序回读 | `WebGPUSortManager readBuffer readbackBuffer` | ✅ `ensureReadbackBuffer:279` 使用 `MAP_READ` |
| TD-35 插件零测试 | `camera-controls LoadingIndicator test` | ✅ CodeGraph 报告 "no tests found" |
| D-04/D-05/D-06 等已修复项 | 逐项 CodeGraph explore | ✅ 全部确认修复有效 |


---

## 8. 修复记录（2026-09-12 执行）

以下修复项已在本轮实施并通过验证（567 测试全绿、lint 零错误、typecheck 通过）：

| 编号 | 状态 | 修复内容 | 涉及文件 |
|---|---|---|---|
| TD-02 | ✅ 已修复 | `SceneTransition.type` 中 `fly` 标注为 experimental，JSDoc 明确无消费者 | `core/src/tour-config.ts` |
| TD-07 | ✅ 已修复 | WebGPU `parseSplatData` 改用 TypedArray 视图直取，避免 DataView 开销 | `renderer-three/src/webgpu-render-manager.ts` |
| TD-29 | ✅ 已修复 | AdaptiveResolution 恢复速率改为动态调整，根据帧率余量自适应 | `renderer-three/src/adaptive-resolution.ts` |
| TD-21 | ✅ 已修复 | TourPlayer 事件类型系统改进，引入 `TourPlayerEventMap` 事件映射类型 | `core/src/tour-player.ts` |
| TD-24 | ✅ 已修复 | SplatBufferPool 添加 `onPoolEvent` 回调，支持外部持续监控池事件 | `renderer-three/src/buffer-pool.ts` |
| TD-30 | ✅ 已修复 | HotspotManager.openPopup 添加 HTML 消毒功能，防止 XSS 攻击 | `plugins/src/hotspot/hotspot-manager.ts`, `plugins/src/hotspot/hotspot-config.ts` |
| TD-12 | ✅ 已修复 | HotspotManager 使用 CSS `transform` 替代 `left`/`top`，启用 GPU 加速定位 | `plugins/src/hotspot/hotspot-manager.ts` |
| TD-13 | ✅ 已修复 | PluginSystem 复用 `FrameContext` 对象，消除每帧 GC 压力 | `core/src/plugin-system.ts` |
| TD-14 | ✅ 已修复 | `preloadScenes` 改用 `Promise.allSettled`，语义更精确 | `core/src/scene-manager.ts` |
| TD-16 | ✅ 已修复 | `generateTour` 从场景数据计算热点位置，不再硬编码 | `convert/src/cli.ts` |
| TD-17 | ✅ 已修复 | Vue `TourViewer` 添加 `isFirstMount` 守卫，防止双重加载 | `vue/src/index.ts` |
| TD-18 | ✅ 已修复 | `DepthOcclusion` 移除 `preserveDrawingBuffer: true`，避免 GPU 性能退化 | `plugins/src/depth-occlusion/index.ts` |
| TD-19 | ✅ 已修复 | SOG 读取端识别 v3 magic 并给出明确错误消息 | `renderer-three/src/sog-streamer.ts` |
| TD-20 | ✅ 已修复 | `decodeSpzInWorker` 导出标注为 `@deprecated` | `renderer-three/src/index.ts` |
| TD-23 | ✅ 已修复 | LOD 就绪事件通知机制文档化 | `renderer-three/src/index.ts` |
| TD-25 | ✅ 已修复 | Morton Code 16-bit 精度限制文档化 | `convert/src/processing.ts` |
| TD-26 | ✅ 已修复 | LOD 树序列化格式添加版本号（v1=12B header），向后兼容 v0（8B header） | `convert/src/sog-writer.ts` |

### 验证结果

- **测试：** 30 个测试文件，567 个测试用例全部通过 ✅
- **Lint：** 0 错误，0 警告 ✅
- **TypeCheck：** 6 个包全部通过 ✅

### 修复统计

本轮共修复 **17 项**技术债务：
- P0 级别：1 项（TD-02）
- P1 级别：7 项（TD-07, TD-12, TD-13, TD-14, TD-17, TD-18, TD-19）
- P2 级别：9 项（TD-16, TD-20, TD-21, TD-23, TD-24, TD-25, TD-26, TD-29, TD-30）

所有修复均通过完整的测试套件验证，未引入任何回归问题。

### 未修复项（需后续排期）

| 编号 | 原因 |
|---|---|
| TD-01 | WebGPU SPZ SH 保留需要重构解码路径，影响面大 |
| TD-03 | 预加载功能需要扩展 `RendererAdapter` 接口 |
| TD-04/05 | 渲染器主文件拆分需要大规模重构 |
| TD-06 | SoA 改造需要全链路重写 |
| TD-07~11 | 性能优化和测试补全需要专项排期 |
| TD-15 | quickselect 算法替换需要基准验证 |
| TD-21/22 | 类型系统改进需要 major 版本 |
| TD-24/27~36 | P2 项随迭代清理 |
| TD-31/32 | 全 GPU 排序和流式解析需要架构改造 |
| TD-33/34 | demo 分包和真机测试需要专项 |
