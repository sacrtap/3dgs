# 完整优化技术方案（核实版）

> **来源:** 对 `docs/technical-debt-plan.md` 与 `docs/technical-optimization-proposals.md` 的逐项代码核实 + 移动端/PC 端专项排查 — 2026-08-27
> **基线（本机实测，macOS）:** `pnpm build` ✅ 通过（demo 单 chunk 5,557 kB / gzip 1,923 kB）；`pnpm test` ✅ 443/443 通过（依赖先构建）
> **实施后实测:** `pnpm test` ✅ 473/473（免构建）；格式/转换性能基准见 `benchmarks/reports/performance-report-2026-08-27.md`
> **结论:** 两份文档中的 17 项新债务与优化条目**全部经代码核实属实**；另新发现 **8 项移动端/PC 端遗漏项**（N-01 ~ N-08）

---

## 1. 核实结论汇总

### 1.1 既有债务核实（全部属实）

| 编号 | 问题 | 核实证据 | 状态 |
|---|---|---|---|
| D-01 | WebGPU 排序/裁剪索引互覆盖 | `webgpu-render-manager.ts` 排序回调 L899 与 `performFrustumCull()` L1081 均 `writeBuffer(splatBuffers.index)` | 🔴 本次修复 |
| D-02 | SOG chunk 失败静默 | `sog-streamer.ts` `loadChunk` catch 仅 `onError`，`chunkDataList` 出现稀疏空洞 | 🔴 本次修复 |
| D-03 | CLI `readFile().buffer` Buffer 池 | `cli.ts` L167/L191 直接 `.buffer` | 🔴 本次修复 |
| D-04 | context restore 精简循环 | `index.ts` L341-358 缺 `_frameCallbacks.invoke()`/`_cameraCache.update()`/`updateInjectionUniforms()` | 🔴 本次修复 |
| D-05 | React 双重加载 | `react/src/index.tsx` 两个 `useEffect` 挂载时均执行 `player.load()` | 🔴 本次修复 |
| D-06 | loadScene Promise 反模式 | `index.ts` L429-465：`new SplatMesh` 先于空 source 检查；URL 路径无超时 | 🔴 本次修复 |
| D-07 | fly/camera:defaults 无消费者 | grep 证实仅 emit 无 on | 🟠 方案见 §4.2 |
| D-08 | WebGPU SPZ 丢 SH | `loadSceneWithSpz` 走 `decodeSpzInWorker`（.splat 布局） | 🟠 方案见 §4.3 |
| D-09 | WebGPU 相机朝向覆盖 | `processSplatData` L697-703：lookAt 后 `camera.rotation.x = Math.PI` | 🔴 本次修复 |
| D-10 | BufferPool 只 acquire 不 release | grep 证实仅 2 处 `acquire`，0 处 `release` | 🟠 本次接线（释放路径） |
| D-11 | preload 空壳 | `scene-manager.ts` `loadScene` 只改状态位，不加载数据 | 🟠 方案见 §4.4（较大，排期） |
| D-12 | FRAGMENT_BEFORE_OUTPUT 语义漂移 | `applyInjectionsToMaterial` 中两枚举走同一分支 | 🟡 本次文档化 + @deprecated 注释 |
| D-13 | 死代码/死字段 | `_compiledMaterials` 仅声明；`_destroyed` 置位未读；`self-test.ts` mock bug | 🟡 本次清理（部分） |
| D-14 | 脚本跨平台失效 | `package.json`：裸 glob lint、`--filter './packages/*'` typecheck、`rm -rf` clean；根无 `"type": "module"` | 🟡 本次修复 |
| D-15 | 测试依赖先构建 | `vitest.config.ts` 无 `@3dgs/*` → src 别名 | 🟡 本次修复（别名） |
| D-16 | 双后端重复代码 | 3 处降采样、多处 fetch 进度循环 | 🟡 排期（抽取共享模块） |
| D-17 | plugins 无子路径导出 | `plugins/package.json` exports 仅 `"."` | 🟡 本次修复 |

### 1.2 既有优化条目核实（全部属实）

| 条目 | 核实证据 | 状态 |
|---|---|---|
| §2.3 排序读回分配 | `webgpu-sort-manager.ts`：每次 sort `new ArrayBuffer(32)`（L207）、新建/销毁 `readbackBuffer`（L225/L273）、`Array.from` 装箱（L254）、`onSubmittedWorkDone()` 全局同步（L238） | ✅ 本次修复 |
| §2.4 DataView 逐字段解析 | `parseSplatData` 逐字段 `DataView`；`dequantizePositions` 逐字节组 Uint24 | 排期（需基准验证） |
| §2.5 加载期误降分辨率 | `AdaptiveResolution` 无 suspend/resume API | ✅ 本次实现 |
| §2.6 每帧分配 | `updateFrustum()` 每 3 帧 `new THREE.Matrix4()` | ✅ 本次修复 |
| §3.2 BufferPool 接线 | 同 D-10 | ✅ 本次 |
| §3.3 demo 分包 | 实测 5,557 kB 单 chunk | 方案见 §4.5 |

---

## 2. 新发现：移动端/PC 端遗漏项（本次排查）

### N-01【高】页面隐藏时渲染循环不暂停

- **证据:** 全仓库无 `visibilitychange` 监听（已核实）。切后台/切标签页后 RAF 继续空转（浏览器虽会节流至 1Hz，但 WebGL/WebGPU 提交与插件更新仍持续），移动端发热耗电，PC 端多标签场景浪费 CPU。
- **方案:** `RenderManager` 与 `WebGPURenderManager` 在 `start()` 中注册 `document.visibilitychange`：隐藏时暂停循环并 `suspend()` 自适应分辨率；恢复时重置 `lastTime` 防巨大 dt 尖峰后重启。`destroy()` 中注销。
- **预期:** 后台 0 GPU/CPU 占用；恢复无跳帧。

### N-02【中】所有设备档 pixelRatio 恒为 1.0，高 DPI 屏发虚

- **证据:** `getTierSettings()` 四档均 `pixelRatio: 1.0`；`start()` 注释明示"不跟随 devicePixelRatio"。性能上正确（dpr=2 时像素量 4x），但 dpr≥2 的手机/Retina 屏渲染 1x 再 CSS 拉伸，画面明显模糊——移动端观感的主要短板。
- **方案:** 按档位设置 `pixelRatio = min(dpr, cap)`：LOW=1.0、MEDIUM=1.0、HIGH=min(dpr,1.25)、ULTRA=min(dpr,1.5)。配合自适应分辨率（帧率低自动降 `resolutionScale`）形成双保险；构造函数 `pixelRatio` 选项仍可覆盖。
- **风险与兜底:** 高分屏像素量上升 → `AdaptiveResolution` 会自动下调 `resolutionScale` 补偿；实测若 ULTRA 档帧率受损，调低 cap 即可（单点配置）。

### N-03【中】iPadOS 被误判为桌面端

- **证据:** `detectDeviceTier()` 仅以 `/Android|iPhone|iPad|iPod/i.test(userAgent)` 判断移动。iPadOS 13+ Safari UA 为 `"Macintosh"`，iPad 会被当作桌面 → 可能分到 HIGH 档 → maxSplats/resolution 过高 → 卡顿。
- **方案:** 增加 `navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)` 的 iPad 判定分支。

### N-04【中】demo 移动端触控与视口适配缺失

- **证据:** `apps/demo/index.html`：canvas 无 `touch-action: none`（触摸拖拽会与页面滚动/下拉刷新竞争）；viewport 无 `viewport-fit=cover`（刘海屏）；`#right-panel` 在窄屏下遮挡画面。
- **方案:** 容器加 `touch-action: none; overscroll-behavior: contain`；viewport 补 `viewport-fit=cover`；媒体查询（≤768px）收起右侧面板与操作说明。

### N-05【低】DPR 变化不响应（浏览器缩放/跨屏拖动）

- **证据:** `ResizeObserver` 只监听容器尺寸，`matchMedia` DPR 变化未监听；PC 端窗口拖到外接屏或 Ctrl± 缩放后 canvas 物理分辨率不更新。
- **方案:** 用 `matchMedia(`(resolution: ${dpr}dppx)`)` 链式监听（标准做法），变化时重取 pixelRatio 并 `updateRenderSize()`。优先级低，列入排期。

### N-06【中】加载期自适应分辨率误降（= 文档 §2.5，升级优先级）

- **证据:** `AdaptiveResolution.sample()` 在加载/LOD 构建的低帧阶段持续采样，会把 `scale` 降到 0.35，就绪后每 45 帧才 +0.1 缓慢回升 → 首屏长时间低画质（移动端尤甚）。
- **方案:** 新增 `suspend()/resume()`；两个渲染器 `loadScene` 开始 suspend、首帧/加载完成 resume。本次实现。

### N-07【低】auto-rotate 不响应 `prefers-reduced-motion`

- **证据:** `plugins/src/auto-rotate` 无 media query 检查。无障碍规范要求。
- **方案:** 初始化时检查 `matchMedia('(prefers-reduced-motion: reduce)')`，命中则默认禁用自动旋转（可被显式选项覆盖）。

### N-08【低】移动端 context lost 恢复路径缺验证（承接债务 L3）

- **证据:** D-04 修复的 restore 循环正是移动端高发路径；`docs/Technical-Debt/technical-debt.md` L3"移动端真机测试"仍未执行。
- **方案:** 本次单测覆盖 restore 后循环完整性（帧回调/相机缓存/注入 uniform 均在循环内）；真机验证列入验收清单。

---

## 3. 本次实施清单（已执行并测试）

| # | 内容 | 涉及文件 |
|---|---|---|
| 1 | D-01：WebGPU 单一索引管线（排序全量有序索引 + 裁剪可见位图 → 合并后一次写入） | `webgpu-render-manager.ts` |
| 2 | D-02：SOG chunk 失败累计 → `start()` 抛错触发回退链；拼接入口校验空洞 | `sog-streamer.ts`、`sog-concat-worker.ts` |
| 3 | D-03：CLI Buffer 池安全切片 | `convert/src/cli.ts` |
| 4 | D-04：主循环提取 `_startRenderLoop()`，restore 复用 | `renderer-three/src/index.ts` |
| 5 | D-05：React `[config]` effect 首挂载守卫 | `react/src/index.tsx` |
| 6 | D-06：空 source 前置检查 + `withTimeout` + 超时后忽略迟到 onLoad | `renderer-three/src/index.ts` |
| 7 | D-09：WebGPU 改为翻转 positions（y 取反），删除相机翻转 | `webgpu-render-manager.ts` |
| 8 | D-10/§3.2：BufferPool 释放路径接线 + `destroy()` clear | `renderer-three/src/index.ts` |
| 9 | D-12：`FRAGMENT_BEFORE_OUTPUT` @deprecated 注释（双后端） | `core/renderer-adapter.ts`、两处注入实现 |
| 10 | §2.3：排序 readbackBuffer 复用、去 `Array.from`、去 `onSubmittedWorkDone`、uniform 复用 | `webgpu-sort-manager.ts` |
| 11 | §2.5/N-06：`AdaptiveResolution.suspend()/resume()` + 两渲染器接线 | `adaptive-resolution.ts`、两个 render manager |
| 12 | §2.6：`updateFrustum` Matrix4 字段复用 | `webgpu-render-manager.ts` |
| 13 | N-01：visibilitychange 暂停/恢复（双后端） | 两个 render manager |
| 14 | N-02：HIGH/ULTRA 档 pixelRatio = min(dpr, cap) | `device-tier.ts`、`index.ts` |
| 15 | N-03：iPadOS 检测 | `device-tier.ts` |
| 16 | N-04：demo 移动端适配（touch-action / viewport-fit / 窄屏媒体查询） | `apps/demo/index.html` |
| 17 | N-07：auto-rotate 尊重 prefers-reduced-motion | `plugins/auto-rotate` |
| 18 | D-13（部分）：删 `_compiledMaterials`、`_destroyed` 校验使用 | `index.ts`、`tour-player.ts` |
| 19 | D-14：lint/typecheck/clean 跨平台脚本 + 根 `"type": "module"` + `scripts/clean.mjs` | `package.json`、各包 `package.json` |
| 20 | D-15-①：vitest 源码别名（免构建测试） | `vitest.config.ts` |
| 21 | D-17：plugins 子路径导出 | `plugins/package.json` |
| 22 | 新增测试：索引管线合并、SOG 失败传播 + 空洞防御、自适应分辨率 suspend、设备分级（iPad/DPR） | 各包 `*.test.ts`（React/Vue 组件测试需引入 testing-library，列入 D-15-②③ 排期） |

## 4. 排期项（本次不实施，给出完整方案）

### 4.1 D-01 后续：裁剪统一为 SpatialGrid（文档 §2.2 / 债务 L4）
`FrustumCulling` 增加 `Float32Array` 构造入口 → `WebGPURenderManager` 用解析出的 positions 构建 → `getVisibleRanges()` 展开为可见位图与 §3 的位图合流 → 删除逐点 `performFrustumCull`。预计 1 天。

### 4.2 D-07 fly/camera:defaults 落地（方案 A）
- `camera-controls`/`DragLookControls` 层监听 `camera:defaults`：应用 `fov/minFov/maxFov/limitPitch`；
- `scene-transition` fly 模式改为：发射帧数据 → 渲染器注册 `onFrame` 消费插值（或过渡插件直接持有相机控制权）。
- 预计 1-2 天；过渡期先在文档标注 `fly` 为 experimental。

### 4.3 D-08 WebGPU SPZ 保留 SH
SPZ 原生解码（含 SH）输出到 WGSL 可消费布局：至少保证 DC 颜色一致，SH 作为二期。预计 1-2 天。

### 4.4 D-11 预加载落地
`RendererAdapter.preloadScene?(source, options): Promise<PreloadedHandle>`（下载+解码，不上传挂载）；`switchScene` 优先消费句柄；不支持的后端静默回退。预计 2 天。

### 4.5 §3.3 demo 分包
`manualChunks` 拆 three/spark；`createRenderer` 对 WebGPU 模块动态 `import()`。预期首屏 gzip -50%。预计 0.5-1 天。

### 4.6 §3.1 convert SoA 改造
解析直出 `GaussianCloudSoA`、prune/mortonSort 提供 SoA 版、writer 接受 SoA。预计 2-3 天，需 5M splat 大文件回归。

### 4.7 §2.4 解析提速 / D-16 共享代码抽取
`Float32Array` 视图直取 + 反量化入 Worker；`fetchWithProgress`/`downsampleSplatBytes`/格式路由抽取。预计合计 2 天。

---

## 5. 验收标准与实测结果（2026-08-27 已执行）

| 验收项 | 结果 |
|---|---|
| 1. `pnpm install && pnpm test` 在**未构建**状态下全绿（vitest 别名） | ✅ `pnpm clean` 后直接测试：23 文件 / **473 通过**（基线 443，新增 30） |
| 2. `pnpm build` + `pnpm lint` + `pnpm typecheck` 全部通过 | ✅ 构建通过；lint 0 错误；typecheck 6 包通过（排除无 tsconfig 的 demo/docs） |
| 3. 新增单测覆盖 | ✅ 索引管线合并 8 例、SOG 失败传播 3 例 + 更新 1 例、拼接空洞防御 4 例、suspend/resume 6 例、iPad/DPR 9 例 |
| 4. demo 双后端手动冒烟 | ⏳ 待真机执行（含债务 L3 移动端真机）；代码侧已具备 visibilitychange 恢复、restore 循环完整性 |
| 5. convert CLI 端到端 | ✅ `splat-to-spz kitchen.splat`：248,038 splats 解析正确，759ms，产物与基准尺寸一致（D-03 验证） |
| 6. 跨平台脚本 | ✅ 新脚本不依赖 shell glob 展开；Windows runner 实测建议纳入 CI（防债务增长机制 #3） |
