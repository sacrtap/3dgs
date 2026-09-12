# 3DGS 重构优化执行计划（2026-09-13）

> 来源：`docs/Technical-Debt/threejs-architecture-research-2026-09-13.md` 第 7/9 节执行计划
> 本文件将全部待执行优化项拆分为逐项执行计划与验证方案，并作为执行进度登记表。
> 范围：所有可在本地闭环验证的优化项执行改造；无法本地闭环的项产出书面方案。
> 工作分支：`refactor/optimization`。

## 1. 可执行性判定汇总

| 判定 | 项 | 说明 |
| --- | --- | --- |
| ✅ 本地可执行（renderer-three） | TD-08、TD-05、TD-01、TD-09、TD-31、TD-04、R-06、N-05 | 共享抽取/拆分/SH/裁剪/排序，均有单元测试或可验证命令 |
| ✅ 本地可执行（convert） | C-01/TD-06、C-02/TD-32、C-03、C-04/TD-19、C-05、C-07、C-09、C-10、TD-15 | CLI + round-trip 测试可闭环 |
| ✅ 本地可执行（core/plugins） | TD-03+R-05、TD-28、TD-33、R-10、R-11 | 接口/测试/文档/示例 |
| ✅ 本地可执行（测试补强） | TD-10、TD-11、TD-27、TD-35、TD-36、R-07 | 新增测试 + 本地基准脚本 + CI 配置 |
| 📄 仅书面方案 | TD-22、TD-34、R-03、R-08、R-09、C-06、C-08、C-11 | 真机/外部 CI/需长时调研/破坏性 API 清理 |
| ⏸ 暂停确认（依赖升级） | R-01（three 0.186.0）、R-02（Spark 2.2.0） | 破坏性变更，按 Stop conditions 先征求确认 |

## 2. 依赖关系与执行批次

```
批次A（renderer-three 共享抽取）     批次C（convert 系列，独立可并行）
  TD-08 抽取 fetch/降采样/SOG 加载       TD-15 quickselect
    │                                   C-01 SoA 接入 ──> C-02 PLY 流式
    └─> TD-05 拆分 shared/ + WGSL 独立      ├─> C-03 SPZ v4/zstd ─> C-11 zstd 策略
          └─> TD-01 SPZ 保留 SH             ├─> C-04 SOG v3 闭环
批次B（renderer-three 性能，成对）          ├─> C-05 压缩 PLY
  TD-09 分块裁剪（CPU，visibility）         ├─> C-07 --max-splats
    └─> TD-31 GPU 计数排序（消费 visibility）├─> C-09 round-trip
批次D（core/plugins/demo）                  └─> C-10 batch 多格式
  TD-03+R-05 预加载 ─> N-05 DPR ─> R-06 统计事件
  TD-28 JSON Schema、TD-33 demo 分割、R-11 文档
批次E（测试补强，可在批次 A/B 稳定后并行）
  TD-10 React/Vue、TD-11 RenderManager、TD-27、TD-35、TD-36、R-07
批次F（书面方案，随时可产出）
  TD-22、TD-34、R-03、R-08、R-09、C-06、C-08
⏸ 依赖升级（批次 A-E 完成后暂停确认）
  R-01、R-02
```

- 批次 A/B 由主代理执行（决策密集文件，AGENTS.md 风险控制）。
- 批次 C 委托 convert 专项代理（文件所有权隔离：`packages/convert/src/`），验收由主代理复核。
- 批次 D/E 视进度委托代理并行。

## 3. 逐项执行计划

### 批次 A：renderer-three 共享抽取

#### TD-08 双后端加载/降采样/进度代码抽取（P1，0 行为变更优先）

- **现状**：`fetchWithProgress` 函数不存在，4 处独立实现进度不一致（webgpu-render-manager.ts:625-669 / :680-696、index.ts:567-596 / :670-709）；降采样两处语义相同布局不同（webgpu L1422-1441 SoA、index L586-602 32B 字节）；SOG 加载逐行重复（webgpu L717-765、index L805-920）；`LoadOptions.onProgress` 单位混用（字节/splat 数）。
- **改动**：
  1. 新建 `packages/renderer-three/src/shared/fetch-util.ts`：`fetchWithProgress(url, onProgress?, signal?): Promise<Uint8Array>`，reader 分块、`total` 未知为 0。
  2. 新建 `packages/renderer-three/src/shared/scene-loader.ts`：`downsampleSplatBytes(data, maxCount, acquireBuffer?): Uint8Array`（WebGL 版，保留 bufferPool 归还语义）、`downsampleSplatData(data, maxCount): SplatData`（WebGPU 版）、`loadSogScene(...)`（两端共用 SOG 流式加载）。
  3. 替换 4 处 fetch 调用点 + 2 处降采样 + 2 处 SOG 加载。
  4. `packages/core/src/renderer-adapter.ts` 的 `LoadOptions` 增加 `onProgressUnits?: 'bytes' | 'splats'`，两端统一。
- **验收信号**：现有 `renderer-three` 测试全绿；`fetchWithProgress` 新增单元测试（mock fetch 流式回调、无 Content-Length、AbortSignal）；行为零变更（对比改动前后加载路径）。
- **验证命令**：`pnpm test`（renderer-three 相关文件）、`pnpm typecheck`、`pnpm lint`。

#### TD-05 WebGPU 渲染管理器拆分与共享（P0）

- **现状**：webgpu-render-manager.ts 1807 行（TS 逻辑约 1250 行，WGSL 字符串 253 行），与 index.ts 重复约 475 行；`mergeSortedVisibleIndices` 为模块级导出；`SplatData` 为文件私有接口。
- **改动**：
  1. WGSL `SPLAT_RENDER_SHADER`（L1555-1807）独立为 `packages/renderer-three/src/wgsl/splat-render-shader.ts`。
  2. 新建 `packages/renderer-three/src/shared/types.ts`：`SplatData`（从 webgpu 私有提升为共享，TD-01 将扩展 sh 字段）。
  3. 抽 `shared/renderer-base.ts` 薄基类（零决策状态与访问器：tierSettings/resolutionScale/尺寸/键盘/相机缓存/onFrame），`RenderManager` 与 `WebGPURenderManager` 组合复用；renderLoop 不进基类。
  4. 更新 `index.ts:1476-1501` re-export 区与测试 import。
- **验收信号**：typecheck/lint/test 全绿；webgpu-render-manager.ts 降到约 600 行；`mergeSortedVisibleIndices` 测试仍通过。
- **验证命令**：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`wc -l` 行数对比。

#### TD-01 WebGPU SPZ 路径保留 SH（P0）

- **现状**：双根因——(a) `spz-decoder-worker.ts` `decodeSpz()` L165-168 显式跳过 SH 流，只输出 32B/splat `.splat` 布局；(b) `SplatData` 无 sh/shDegree 字段、管线无 SH binding、WGSL 无 SH 求值。WebGL 端已修复（Spark 直吃 SPZ 字节，TD-20）。
- **改动**（方案 A，最小改动）：
  1. `spz-decoder-worker.ts` 新增 `decodeSpzToSplatData(data, targetShDegree?): Promise<SplatData>`：复用 gzip 解压 + 偏移计算，读取第 6 节 SH 流并反量化（`(v-128)/128`，与 spz-writer.ts `quantizeSh` 对应），返回含 `sh: Float32Array` + `shDegree` 的 SoA。
  2. `SplatData` 增加 `sh: Float32Array | null`、`shDegree: number`；`parseSplatData`/`downsampleSplatData`/`uploadSplatData` 同步支持。
  3. 管线追加 SH storage buffer（binding 6，read-only-storage）；WGSL 在 `vs_main` 传 viewDir、`fs_main` 做 SH 求值（SH_C0 = 0.28209479177387814）；`tierSettings.shDegree` 参与 `targetShDegree = min(header.shDegree, tier.shDegree)`。
  4. `loadSceneWithSpz` 改调 `decodeSpzToSplatData`，进度改流式（与 WebGL 对齐）。
- **验收信号**：新增 `decodeSpzToSplatData` 单元测试：构造 shDegree=1 的 SPZ（用 convert writeSpz 生成），断言 sh 反量化误差在量化桶内（±1/128×2^bits）；更新 `spz-decoder-worker.test.ts` L671-675 的"丢 SH"断言语义；round-trip 测试：writeSpz → decodeSpzToSplatData → 与源数据对比 SH 近似。
- **验证命令**：`pnpm test`（spz-decoder-worker、webgpu-render-manager 相关）、`pnpm typecheck`、`pnpm lint`。
- **风险**：webgpu-render-manager.ts 为决策密集文件；WGSL 修改需在支持 WebGPU 环境验证（本地无 GPU 时以测试断言 + typecheck 兜底）；SPZ 布局是整文件 gzip（header+body 一起），解压必须从字节 0 开始。

### 批次 B：renderer-three 性能专项

#### TD-09 WebGPU 视锥裁剪统一到空间分块（P1）

- **现状**：`performFrustumCull()`（webgpu-render-manager.ts:1174-1202）逐 splat O(N×6) `Frustum.containsPoint`；`SpatialGrid`（frustum-culling.ts）**依赖 Morton 排序假设**，与 WebGPU 非 Morton 数据不兼容，不能直接复用。
- **改动**：
  1. 新建 `packages/renderer-three/src/splat-grid-culler.ts`：`SplatGridCuller(positions: Float32Array, count, resolution=8)`，对 positions 分 8³ cell，记录 `members: Uint32Array` + `bbox`（**不依赖 Morton**）。
  2. `performFrustumCull()` 改为：`mask.fill(0)` → 512 cell 级 `intersectsBox` → 命中 cell 遍历 members 置 1；输出仍是 `_visibleMask`，`mergeAndUploadIndices` 不变。
  3. 增加 mask 变更检测（比对上次 mask），未变化时跳过 `mergeAndUploadIndices` 的 writeBuffer（消除每 3 帧 4MB 回写）。
  4. 与 WebGL 对齐的可视化统计：可选 `getVisibleRatio` 日志（不阻塞主改造）。
- **验收信号**：`SplatGridCuller` 单元测试：构造已知 positions，断言可见/不可见分组正确、`members` 覆盖全部索引；`performFrustumCull` 在 mock frustum 下输出 mask 与逐 splat 结果一致（等价性测试）；mask 变更检测测试。
- **验证命令**：`pnpm test`（新增测试 + webgpu-render-manager 相关）、`pnpm typecheck`、`pnpm lint`。
- **风险**：`mergeSortedVisibleIndices` 4 分支不变式；`_visibleMask` 语义（1=可见）；与 TD-31 的 visibility buffer 契约（TD-09 的 CPU mask 先落地，TD-31 改造时升级为 GPU visibility）。

#### TD-31 WebGPU 排序全 GPU 化（P1，与 TD-09 成对）

- **现状**：`WebGPUSortManager.sort()`（webgpu-sort-manager.ts:202-290）GPU 算距离（1 个 compute pass）→ `mapAsync` 回读 → CPU `Uint32Array.sort` → `writeBuffer` 回写。两次跨边界传输。
- **改动**（计数排序，8bit=256 桶，O(N)）：
  1. Pass A：距离 compute 输出归一化 bucket 值（保留 CPU 回退 `sortOnCPU`/`sortOnCPUStatic`）。
  2. Pass B：直方图（workgroup 局部直方图 + 原子累加）；Pass C：256 长度前缀和；Pass D：散射（`atomicAdd(&counter[bucket])`）写 `sortedByBucket`；Pass E：桶内精排 + 消费 TD-09 visibility mask，直写最终 drawIndices 与 visibleCount。
  3. `sort()` 返回 `indices` 改为可选，`method` 扩展 `'gpu-hybrid' | 'gpu-native' | 'cpu'`；renderLoop 不再依赖 `result.indices`，改用 `getIndexBuffer()` + `getVisibleCount()`。
  4. `init()` requiredLimits `maxStorageBuffersPerShaderStage` 6→10；`adjustForGpuLimits` bytesPerSplat 64→~100。
- **验收信号**：新增 sortManager 单元测试：mock GPU 设备（无 GPU 环境走 CPU 回退断言）；计数排序结果与 CPU 排序等价（同距离稳定序）；`method` 字段正确；现有 `webgpu-sort-manager.test.ts` 全绿。
- **验证命令**：`pnpm test`、`pnpm typecheck`、`pnpm lint`。
- **风险**：atomic 支持（消费级 GPU 的 `atomicAdd` on storage 为强制功能）；TD-09 未完成前保持 CPU mask 契约，避免双写竞争；决策注释锚点（§2.3 三次迭代记录）保留。

### 批次 C：convert 系列（专项代理，文件所有权：packages/convert/src/）

#### TD-15 contributionCutoff quickselect（P1）
- 现状：全排序 + slice。改动：`contributionCutoff` 路径改用 quickselect（nth_element 语义），保留阈值剪枝。验收：新增测试（乱序输入 → 截断后 top-K 与全排序一致）；CLI 冒烟。

#### C-01/TD-06 convert 全链路接入 GaussianCloudSoA（P0）
- 现状：`gaussian-loader.ts:697` AoS 对象数组主路径；`toSoA()` 仅测试路径。改动：解析（PLY/SPLAT）直出列式 TypedArray；写入器（SPLAT/SPZ/SOG）消费 SoA；AoS 保留为兼容 API（标记 deprecated）。验收：`GaussianCloudSoA` 相关测试全绿；大文件（≥5M splat 合成数据）转换在常规 Node 堆完成（`--max-old-space-size=4096` 冒烟）；CLI `ply-to-splat`/`ply-to-spz` 输出与 AoS 结果一致（byte 级对比）。

#### C-02/TD-32 PLY 流式解析（P1）
- 现状：整文件读入 + 拷贝。改动：`ply-parser.ts` 增加流式读取（分块 Buffer + 按行解析 header、属性按列流式提取）；与 C-01 的 SoA 直出衔接。验收：内存峰值下降测试（合成大 PLY，对比峰值 RSS）；解析结果与原实现 byte 级一致；测试全绿。

#### C-03 SPZ v4/zstd 读写 + v1-v3 兼容测试（P1）
- 现状：只写 SPZ v2（整文件 gzip），无 reader、无 zstd。改动：新增 `spz-reader.ts`（解压 + header/body 解析，输出 GaussianCloudSoA）；v4 支持 zstd（引入 zstd-wasm 或 fzstd 依赖，见 C-11 决策）；v1-v3 兼容测试。验收：round-trip 测试（write v2 → read → write v4 → read，数值一致性在量化误差内）；兼容测试覆盖 v1/v2/v3 布局（合成字节）；CLI 冒烟。

#### C-04/TD-19 SOG v3 SH overlay 读写闭环（P1）
- 现状：`SOG_MAGIC_V3` 常量存在但 `parseSogMetadata` 当无效 magic 抛错；写入端写 v2。改动：读取端识别 v3 并解析 SH overlay；写入端支持 `--sog-version 3`（SH 数据接入）；v2/v3 双向 round-trip 测试。验收：v3 读取不再抛错；round-trip 测试（v3 写→读 SH 系数一致）；测试全绿。

#### C-05 压缩 PLY 输出（P2）
- 现状：只读 SuperSplat 打包 PLY，不写。改动：新增压缩 PLY 写入（SuperSplat 兼容：紧凑二进制 + 量化）；round-trip 验证可被自身读取。验收：写入产物可被本包读取回数据一致；与 SuperSplat 打包 PLY 的结构对比测试。

#### C-07 CLI --max-splats 转换期预裁剪 + 质量回执（P1）
- 现状：CLI 无转换期预裁剪参数。改动：`cli.ts` 增加 `--max-splats`（转换期降采样/裁剪，复用 prune 逻辑）；输出质量回执（原始数 → 裁剪数 → 保留比例）。验收：CLI 冒烟测试（合成 PLY 转 SPLAT/SPZ，断言 splat 数 ≤ max-splats、回执输出正确）；测试全绿。

#### C-09 跨格式 round-trip 基准文件 + 自动质量回归套件（P1）
- 现状：缺基准文件与回归套件。改动：`packages/convert/test-fixtures/` 生成小型基准 PLY（含 SH degree 1-3）；round-trip 回归脚本（PLY→SPLAT→PLY 等组合，误差在 8-bit 量化极限内断言）；接入 vitest。验收：回归套件全绿；误差断言明确（位置 < 1e-4 相对误差、颜色 8-bit、SH 在量化桶内）。

#### C-10 batch CLI 支持多输入格式 + manifest（P2）
- 现状：batch 只扫 `.ply`。改动：支持 SPLAT/SPZ/SOG 输入；输出 manifest（JSON：输入/输出/数量/耗时）。验收：CLI 冒烟（混合格式目录 batch，断言 manifest 内容）；测试全绿。

#### C-11 zstd 依赖策略与浏览器兼容性验证（P2，书面结论）
- 现状：无 zstd 支持。改动：调研 zstd-wasm / fzstd / 原生 CompressionStream 支持度；产出策略文档（Node CLI vs 浏览器差异、包体积、加载方式）；选择依赖并接入 C-03。验收：策略文档产出；若选型落地则 round-trip 测试通过。

### 批次 D：core/plugins/demo

#### TD-03+R-05 预加载端到端落地（P0）
- 现状：`SceneManager.preload()`（scene-manager.ts:86-99）只置状态；`RendererAdapter` 无 `preloadScene` 方法；renderer-three 无 preload 实现。
- 改动：`RendererAdapter` 增加 `preloadScene(source, options?): Promise<PreloadHandle> | undefined`（默认 undefined，向后兼容）；`SceneManager.preload/preloadScenes` 调用之并跟踪句柄；renderer-three 两端实现（WebGL：提前 fetch + SplatMesh 预建或字节缓存；WebGPU：fetch + decode 缓存）；`TourConfig` 支持 preload 场景列表。
- 验收：core 单元测试（preload 调用渲染器、句柄生命周期）；renderer-three 测试（preload 后 loadScene 命中缓存不重复 fetch，mock fetch 断言调用次数）；typecheck/lint 全绿。

#### N-05 DPR 变化监听（P1）
- 现状：DPR 构造期一次性读取。改动：renderer-three 增加 `matchMedia('(resolution: ...)')`/`visualViewport` resize 监听，DPR 变化时重算 tierSettings.cappedDpr 并触发 setPixelRatio/分辨率回调。验收：新增单元测试（模拟 DPR 变化 → 断言回调触发与重算值）；现有测试全绿。

#### R-06 渲染统计、池命中率和帧时间事件接口（P1）
- 现状：BufferPool 已有 `PoolEvent/onPoolEvent`（buffer-pool.ts:48-60）但 RenderManager 未接；统计接口零散（getBufferPoolStats/getResolutionScale/isLodReady）。
- 改动：RendererAdapter 或 RenderManager 增加 `onStats?` 回调 / `getStats()`：帧时间（smoothDt 平均）、池命中率（命中/未命中）、可见 splat 数、分辨率 scale；接入 AdaptiveResolution 与 BufferPool 事件。验收：新增单元测试（模拟事件 → 断言统计聚合正确）；demo 或测试可观测输出。

#### TD-28 TourConfig JSON Schema（P2）
- 现状：tour-config.ts 手写校验。改动：新增 `packages/core/schema/tour-config.schema.json`（完整 TourConfig 结构）；导出 `validateTourConfigJson(json): {valid, errors}` 使用 schema 校验（无新依赖，手写校验器或 ajv 可选）。验收：schema 文件存在且通过 JSON Schema 语法校验；测试（合法/非法配置断言）；typecheck 全绿。

#### TD-33 demo 代码分割（P1）
- 现状：apps/demo/index.html 内联 1127 行 JS 单函数。改动：拆为 `apps/demo/src/*.ts` 模块（viewer 初始化、benchmark 控制、场景切换、HUD），vite 构建产物按需分割；index.html 保留骨架。验收：`pnpm --filter @3dgs/demo build` 成功且产物含拆分 chunk；页面冒烟（dev server 打开正常）。

#### R-11 插件开发文档补强（P2）
- 现状：plugin-dev.md 213 行覆盖基础。改动：补充 DragLookControls 接入、事件命名规范（`plugin:xxx`）、性能合约（不得阻塞渲染循环）、错误契约（onError 语义）、贡献模板。验收：文档产出并链接到 docs 站点导航。

#### R-10 R3F/Three.js 生态适配示例（P2）
- 现状：无 R3F 适配。改动：新增示例（`examples/r3f/` 或 demo 页）：TourViewer 嵌入 R3F Canvas 的最小示例；依赖 `@react-three/fiber`（devDependency 于示例工程）。验收：示例构建通过（`pnpm --filter` build）；README 说明。

### 批次 E：测试补强

#### TD-10 React/Vue 组件测试（P1）
- 改动：为 `packages/react/src/index.tsx`、`packages/vue/src/index.ts` 新增组件测试（jsdom 环境，`// @vitest-environment jsdom` 或测试配置）；断言挂载/卸载/守卫行为。验收：测试通过；根 devDependencies 的 jsdom 版本满足 Node 22。

#### TD-11 RenderManager 主流程测试（P1）
- 改动：mock Spark 依赖，覆盖 createRenderer → mount → loadScene（splat/spz/sog 分发）→ destroy 生命周期。验收：新增测试文件通过。

#### TD-27 DragLookControls 单元测试（P2）
- 改动：`drag-look-controls.ts` 独立测试（指针事件模拟：按下/拖动/释放、滚轮前进、YXZ 欧拉约束）。验收：测试通过。

#### TD-35 camera-controls 与 LoadingIndicator 测试（P2）
- 改动：plugins 两个插件新增测试（事件监听/触发/清理）。验收：测试通过。

#### TD-36 Fullscreen 插件测试（P2）
- 改动：fullscreen 插件测试（dblclick 切换、fullscreenchange 事件桥、退出清理）。验收：测试通过。

#### R-07 基准测试纳入 CI 门禁（P1）
- 改动：基准脚本（benchmarks/benchmark.ts）增加阈值断言（如 Garden P50 ≥ 30 FPS）；CI ci.yml 基准 job 增加失败条件。验收：本地跑基准脚本通过；CI 配置语法有效。

### 批次 F：书面方案（全部为独立文档，产出到 docs/Technical-Debt/）

| ID | 方案文档 | 内容 |
| --- | --- | --- |
| TD-22 | shader-hookpoint-semantics.md | ShaderHookPoint 语义清理方案（major 版本执行），FRAGMENT_BEFORE_OUTPUT 语义漂移现状与迁移路径 |
| TD-34 | mobile-real-device-testing.md | 移动端真机测试方案（设备矩阵、测试矩阵、context lost 验证流程） |
| R-03 | webgpu-promotion-evaluation.md | 官方 WebGPURenderer/TSL vs 自研 WGSL 对比评估框架（性能/画质/维护成本/迁移路径） |
| R-08 | windows-ci-plan.md | CI Windows runner 方案（workflow 增补 + 跨平台脚本注意点） |
| R-09 | mobile-baseline-plan.md | 移动端真机性能基线方案（指标、采集、阈值） |
| C-06 | format-adaptation-research.md | KSPLAT/LCC/RAD 适配可行性研究（格式结构、互操作成本、结论） |
| C-08 | worker-wasm-conversion.md | Web Worker/WASM 转换路径评估（架构、依赖、可行性、落地建议） |

### ⏸ 依赖升级（暂停确认后执行）

#### R-01 升级 three → 0.186.0（P0）
- 改动：`packages/renderer-three/package.json` peerDependency `^0.185.0` → `^0.186.0`；lockfile 更新；r186 7 个 breaking change 回归清单（Object3D.dispose()、SimplifyModifier 异步等）。验收：全量 test/typecheck/lint/build 绿。

#### R-02 升级 Spark → 2.2.0（P0）
- 改动：`@sparkjsdev/spark` devDependencies 版本更新；格式/排序/LOD 回归。验收：全量门禁绿 + demo 冒烟。

## 4. 验证登记表（执行中更新）

| 项 | 验收信号 | 验证命令 | 结果 | 日期 |
| --- | --- | --- | --- | --- |
| TD-08 双后端加载代码抽取 | 现有测试全绿；fetchWithProgress 新增单测 | `vitest run packages/renderer-three` | ✅ 通过 | 2026-09-13 |
| TD-05 WebGPU 管理器拆分共享 | typecheck/lint/test 全绿；webgpu 行数下降 | `vitest run` + typecheck | ✅ 通过 | 2026-09-13 |
| TD-01 WebGPU SPZ 保留 SH | decodeSpzToSplatData 单测；round-trip | `vitest run packages/renderer-three` | ✅ 通过 | 2026-09-13 |
| TD-09 视锥裁剪统一 SpatialGrid | SplatGridCuller 单测；等价性测试 | `vitest run packages/renderer-three` | ✅ 通过 | 2026-09-13 |
| TD-15 quickselect | top-K 与全排序一致；100K 性能 | `vitest run packages/convert` | ✅ 通过 | 2026-09-13 |
| C-01 convert 接入 SoA | SoA 相关测试全绿 | `vitest run packages/convert` | ✅ 通过（129 用例） | 2026-09-13 |
| C-02/TD-32 PLY 流式解析 | 跨分块/整除边界用例（20s 超时） | `vitest run packages/convert/src/soa.test.ts` | ✅ 通过（9 用例） | 2026-09-13 |
| C-03 SPZ v1-v4 读取器 | 11 用例（round-trip/版本布局/NGSP/zstd mock） | `vitest run packages/convert/src/spz-reader.test.ts` | ✅ 通过 | 2026-09-13 |
| C-04/TD-19 SOG v3 SH overlay | 7 个 v3 用例；v2/v3 双向 round-trip | `vitest run packages/convert/src/sog-writer.test.ts` | ✅ 通过 | 2026-09-13 |
| C-05 压缩 PLY 输出 | 6 用例（round-trip/header/边界/除零） | `vitest run packages/convert/src/compressed-ply.test.ts` | ✅ 通过 | 2026-09-13 |
| C-07 CLI --max-splats | 9 用例（产物尺寸/组合/跨格式/sog-version） | `vitest run packages/convert/src/cli.test.ts` | ✅ 通过 | 2026-09-13 |
| C-09 round-trip 回归套件 | 17 用例（SPLAT/SPZ/SOG 全链路量化阈值） | `vitest run packages/convert/src/round-trip.test.ts` | ✅ 通过 | 2026-09-13 |
| C-10 batch 多格式 + manifest | 2 用例（独立子目录隔离） | `vitest run packages/convert/src/cli.test.ts` | ✅ 通过 | 2026-09-13 |
| C-11 zstd 依赖策略 | 策略文档产出（默认选项 A） | `docs/Technical-Debt/c11-zstd-dependency-policy.md` | ✅ 文档 | 2026-09-13 |
| TD-03+R-05 预加载端到端 | core 单测；renderer preload 缓存命中 | `vitest run packages/core packages/renderer-three` | ✅ 通过 | 2026-09-13 |
| N-05 DPR 变化监听 | DPR 变化 → 回调触发与重算值 | `vitest run packages/renderer-three` | ✅ 通过 | 2026-09-13 |
| R-06 统计事件接口 | 模拟事件 → 统计聚合正确 | `vitest run packages/renderer-three` | ✅ 通过 | 2026-09-13 |
| TD-04 renderer index 拆分 | typecheck/lint/test 全绿 | `vitest run` + typecheck | ✅ 通过 | 2026-09-13 |
| TD-28 TourConfig JSON Schema | schema 文件 + 合法/非法配置断言 | `vitest run packages/core` | ✅ 通过 | 2026-09-13 |
| TD-33 demo 代码分割 | demo build 成功且产物含拆分 chunk | `pnpm --filter @3dgs/demo build` | ✅ 通过 | 2026-09-13 |
| R-10 R3F 生态适配示例 | 示例 build 通过 + README | `pnpm --filter @3dgs/r3f-example build` | ✅ 通过 | 2026-09-13 |
| R-11 插件开发文档 | 文档产出并链接 docs 导航 | 文档审查 | ✅ 完成 | 2026-09-13 |
| TD-10 React/Vue 组件测试 | 7+11 用例（含 Vue isFirstMount bug 修复） | `vitest run packages/react packages/vue` | ✅ 通过 | 2026-09-13 |
| TD-11 RenderManager 主流程测试 | 13 用例（构造/挂载/加载/销毁幂等） | `vitest run packages/renderer-three/src/render-manager.test.ts` | ✅ 通过 | 2026-09-13 |
| TD-27 DragLookControls 测试 | 指针事件模拟用例 | `vitest run packages/renderer-three/src/drag-look-controls.test.ts` | ✅ 通过 | 2026-09-13 |
| TD-35/36 插件测试 | loading-indicator 6 + fullscreen 6 用例 | `vitest run packages/plugins/src/plugin-tests.test.ts` | ✅ 通过（12 用例） | 2026-09-13 |
| R-07 基准测试纳入 CI 门禁 | 基准脚本阈值断言 + CI job | ci.yml 审查 | ✅ 完成 | 2026-09-13 |
| TD-22 ShaderHookPoint 语义方案 | 书面方案（major 版本执行） | `docs/Technical-Debt/td22-shader-hookpoint-semantics.md` | ✅ 文档 | 2026-09-13 |
| TD-34 移动端真机方案 | 书面方案（设备矩阵/测试矩阵/context lost） | `docs/Technical-Debt/td34-mobile-real-device-testing.md` | ✅ 文档 | 2026-09-13 |
| R-03 WebGPU 转正评估 | 书面方案（对比框架/统计指标/迁移路径） | `docs/Technical-Debt/r03-webgpu-promotion-evaluation.md` | ✅ 文档 | 2026-09-13 |
| R-08 Windows CI 方案 | 书面方案（runner/workflow/跨平台注意点） | `docs/Technical-Debt/r08-windows-ci-plan.md` | ✅ 文档 | 2026-09-13 |
| R-09 移动端基线方案 | 书面方案（指标/采集/阈值） | `docs/Technical-Debt/r09-mobile-baseline-plan.md` | ✅ 文档 | 2026-09-13 |
| C-06 KSPLAT/LCC/RAD 调研 | 书面调研（不引入新格式结论） | `docs/Technical-Debt/c06-format-adaptation-research.md` | ✅ 文档 | 2026-09-13 |
| C-08 Worker/WASM 转换评估 | 书面方案（零新依赖结论） | `docs/Technical-Debt/c08-worker-wasm-conversion.md` | ✅ 文档 | 2026-09-13 |
| TD-31 GPU 计数排序 | 书面方案（5-pass 设计；无法本地闭环） | `docs/Technical-Debt/td31-gpu-counting-sort.md` | ✅ 文档 | 2026-09-13 |

> **R-01 / R-02（依赖升级）**：✅ 已获用户确认并执行完成（2026-09-13）。
> - R-01: three `^0.185.0` → `^0.186.0`（renderer-three peer+dev、r3f-example dev），`@types/three` → `0.186.0`；实测安装 three 0.186.0 / @types/three 0.186.0；r186 breaking changes 回归清单（Object3D.dispose()、SimplifyModifier 异步等）经全量测试覆盖。
> - R-02: `@sparkjsdev/spark` `^2.1.0` → `^2.2.0`（peer+dev）；实测安装 2.2.0；格式/排序/LOD 回归经全量测试覆盖。
> - 验证：`pnpm test` 718/718 通过、typecheck 通过、`pnpm lint` 通过、`pnpm build` 9 包 Done、demo preview 冒烟通过（浏览器加载正常）。

## 5. 最终验证

全部批次完成后：
1. `pnpm test` — **✅ 通过（44 文件 / 718 用例全绿）**
2. `pnpm typecheck` — **✅ 通过**（`pnpm --filter "@3dgs/*" --filter "!@3dgs/demo" --filter "!@3dgs/docs" --filter "!@3dgs/r3f-example" --no-bail exec -- tsc --noEmit`；r3f-example 与 demo 同为 vite 示例无 tsconfig，已加入排除）
3. `pnpm lint`（--max-warnings 0）— **✅ 通过**
4. `pnpm build` — **✅ 通过**（先 `pnpm --filter @3dgs/core build` 再全量）
5. 更新本文件验证登记表 + 汇总 commit — **✅ 完成**
