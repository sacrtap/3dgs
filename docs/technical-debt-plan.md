# 技术债务方案

> **来源:** 全量代码 Review — 2026-08-27
> **关联文档:** `docs/Technical-Debt/technical-debt.md`（历史债务登记）、`docs/technical-optimization-proposals.md`（优化方案）
> **维护原则:** 每项债务记录根因、影响、修复方案、预计成本；修复后回填状态与验证结果

---

## 1. 债务全景

本次 Review 共识别 **17 项新债务** + 复核 **3 项存量未决债务**（L3/L4/L5）。按影响分级：

- 🔴 **P0 — 功能失效或潜在崩溃**（6 项）：影响正确性，应立即修复
- 🟠 **P1 — 功能缺陷/承诺未兑现**（6 项）：影响用户体验或开发流程，近期排期
- 🟡 **P2 — 代码卫生/可维护性**（5 项）：随迭代顺带清理

---

## 2. 🔴 P0 — 立即修复

### D-01: WebGPU 排序索引与视锥裁剪索引互相覆盖

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-render-manager.ts`（renderLoop 排序回调 ~L888、performFrustumCull ~L1068） |
| **根因** | GPU 排序结果与视锥裁剪结果都写入同一个 `splatBuffers.index`，两个异步路径互不知晓对方，后写者覆盖先写者 |
| **影响** | WebGPU 后端：排序被覆盖 → alpha 混合顺序错误（半透明伪影）；裁剪被覆盖 → 裁剪失效。两项优化均名存实亡 |
| **修复方案** | 建立单一索引管线：排序产出全量有序索引，裁剪产出可见位图，合并后仅写入一次（详细设计见优化文档 §2.1） |
| **预计成本** | 1 天（含测试） |

### D-02: SOG chunk 加载失败导致拼接崩溃

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/sog-streamer.ts`（loadChunk catch 仅回调不抛出）、`index.ts` / `webgpu-render-manager.ts` 的 `loadSceneWithSog*` |
| **根因** | `loadChunk` 失败时只调 `onError`，`start()` 照常 resolve；`chunkDataList` 留下稀疏空洞（`undefined`），`concatChunksInWorker` 内 `new Uint8Array(undefined)` 抛 TypeError |
| **影响** | 弱网/部分 chunk 404 时场景加载直接崩溃而非走回退链 |
| **修复方案** | ① `loadChunk` 失败计入失败集合，`start()` 结束时若有缺失 chunk 则 `throw`（触发渲染器回退到 `.splat` 直加载）；② `concatChunksInWorker` 入口校验数组无空洞（防御性） |
| **预计成本** | 0.5 天 |

### D-03: CLI `readFile().buffer` 可能携带 Buffer 池多余字节

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/convert/src/cli.ts`（L167 `plyBuffer.buffer`、L191 `splatBuffer.buffer`、L470/L480 `buffer.buffer`） |
| **根因** | Node `fs.readFile` 返回的 Buffer 可能来自共享内存池（`byteOffset !== 0`），`.buffer` 暴露的是整个池 ArrayBuffer |
| **影响** | 解析器可能读到错误偏移的数据或越界——小文件场景高发，表现为转换结果错乱或校验失败，难以排查 |
| **修复方案** | 统一改为 `buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)`，或在 `loadGaussiansFromPly/Splat` 入口接受 `Uint8Array` 并自行处理视图 |
| **预计成本** | 0.5 天（含回归测试） |

### D-04: WebGL context restore 后的 RAF 循环缺失关键步骤

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（`_contextRestoredHandler` 内的第二个简化版 loop，~L341-358） |
| **根因** | context restore 后启动的是精简版循环，未调用 `_frameCallbacks.invoke()`、`_cameraCache.update()`、`updateInjectionUniforms()` |
| **影响** | 移动端 context 恢复后：TourPlayer 与所有插件停止更新（热点不再投影、过渡动画冻结）、热点坐标使用旧矩阵、注入 uniform 停更 |
| **修复方案** | 将主循环提取为私有方法 `_startRenderLoop()`，`start()` 与 restore 处理器共用同一实现，杜绝双份逻辑漂移 |
| **预计成本** | 0.5 天 |

### D-05: React TourViewer 挂载时双重加载配置

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/react/src/index.tsx`（`[renderer, plugins]` effect 与 `[config]` effect 均在挂载时执行） |
| **根因** | 两个 `useEffect` 在首次挂载都会执行 `player.load()` |
| **影响** | `load` 事件触发两次；对象字面量 config 会构建两份 runtime；网络请求重复 |
| **修复方案** | `[config]` effect 增加 `isFirstMount` ref 守卫跳过首次执行（首次加载由主 effect 负责） |
| **预计成本** | 0.5 天（含组件测试） |

### D-06: `loadScene` Promise 执行器反模式 + 无超时保护

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（loadScene ~L429-465、createSplatMeshFromBytes ~L530-556） |
| **根因** | ① `new SplatMesh(...)` 在 `if (!source) reject` 检查之前执行；② URL 直加载路径无超时，`onLoad` 不触发则 Promise 永久挂起；③ `setTimeout` reject 后无清理，成功时定时器仍驻留 30s，且超时后迟到的 `onLoad` 仍会修改场景状态 |
| **影响** | 加载异常场景下 UI 永久卡在 loading；超时与成功竞态时场景状态不一致 |
| **修复方案** | ① 空 source 检查前置；② 统一 `withTimeout(promise, ms, onTimeout)` 包装并在解决时 `clearTimeout`；③ 超时后标记废弃，忽略迟到的 `onLoad` |
| **预计成本** | 0.5 天 |

---

## 3. 🟠 P1 — 近期排期

### D-07: fly 场景过渡与相机默认值"有名无实"

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/plugins/src/scene-transition/index.ts`（emit `transition:fly:frame`）、`packages/core/src/tour-player.ts`（emit `camera:defaults`） |
| **根因** | 两个事件均无任何监听者（grep 证实）：渲染器未消费 fly 帧数据，相机插件未消费默认值 |
| **影响** | 配置了 `fly` 过渡或 `defaults.camera` 的项目实际无效果，文档承诺与行为不符 |
| **修复方案** | 二选一：**A（推荐）** 在 `camera-controls` 插件中监听 `camera:defaults` 应用 fov/pitch 限制、监听 `transition:fly:frame` 驱动 yaw/pitch/fov 插值；**B** 若短期无人力，先从文档与类型中下线 `fly` 选项，避免误导 |
| **预计成本** | A：1-2 天；B：0.5 天 |

### D-08: WebGPU 后端 SPZ 路径丢失 SH 数据

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-render-manager.ts`（loadSceneWithSpz 使用 `decodeSpzInWorker`） |
| **根因** | WebGL 路径已通过 C1 决策改为 SPZ 原生加载以保留 SH，WebGPU 路径仍走旧的 Worker 解码（输出 .splat，SH 被丢弃） |
| **影响** | 双后端画质不一致（视角依赖着色丢失）；WebGPU 转正时的阻断项 |
| **修复方案** | WebGPU 路径同样先做 SPZ 原生解码（复用 Spark 解码结果或直接移植 spz 解码到 WGSL 可消费的布局），至少保证 DC 颜色与 WebGL 路径一致 |
| **预计成本** | 1-2 天 |

### D-09: WebGPU 相机朝向逻辑顺序错误

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/webgpu-render-manager.ts`（processSplatData ~L696-703） |
| **根因** | 先 `positionCameraToBounds()`（内部 `lookAt` 设定朝向），随后 `camera.rotation.x = Math.PI` 直接覆盖 lookAt 结果；且与 WebGL 路径"翻转 mesh"策略不一致 |
| **影响** | WebGPU 后端初始视角不可预期 |
| **修复方案** | 统一为"翻转数据/场景，相机保持 lookAt"：对 `splatData.positions` 的 y 取反（一次性预处理），或在 WGSL 中乘翻转矩阵；删除相机翻转 |
| **预计成本** | 0.5 天 |

### D-10: BufferPool 与 SoA 优化未接入生产路径

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（只 acquire 不 release）、`packages/convert/src/gaussian-loader.ts`（toSoA 仅测试使用） |
| **根因** | 优化代码已写好并测试，但没有在主流程接线 |
| **影响** | 宣称的"减少场景切换分配"与"转换内存 -30%"实际为零；convert 大文件仍依赖 8GB 堆 |
| **修复方案** | 见优化文档 §3.1 / §3.2 的接线方案 |
| **预计成本** | BufferPool 接线 0.5 天；SoA 改造 2-3 天 |

### D-11: 预加载（preload）功能为空壳

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/core/src/scene-manager.ts`（loadScene 仅改状态） |
| **根因** | 设计上把真实加载委托给渲染器，但预加载路径没有对应的渲染器调用 |
| **影响** | 多场景漫游"无缝切换"承诺不成立，切换时必须全量等待下载 |
| **修复方案** | 见优化文档 §3.4：`RendererAdapter.preloadScene?` 可选接口 + `switchScene` 消费预加载句柄 |
| **预计成本** | 2 天 |

### D-12: `FRAGMENT_BEFORE_OUTPUT` 钩子语义漂移

| 字段 | 内容 |
|---|---|
| **涉及文件** | `packages/renderer-three/src/index.ts`（applyInjectionsToMaterial switch）、`packages/core/src/renderer-adapter.ts`（枚举注释） |
| **根因** | 因 Spark GLSL3 下 `fragColor` 赋值时序问题，该钩子被改为注入到 `main()` 末尾（赋值**之后**），但接口注释仍写"最终输出前"，且与 `FRAGMENT_MAIN_END` 行为完全相同 |
| **影响** | 依赖旧语义的注入代码行为改变；两个枚举值语义重叠造成困惑 |
| **修复方案** | 更新 `ShaderHookPoint` 注释明确现行语义；或将 `FRAGMENT_BEFORE_OUTPUT` 标记 `@deprecated` 指向 `FRAGMENT_MAIN_END`；文档示例同步 |
| **预计成本** | 0.5 天 |

---

## 4. 🟡 P2 — 代码卫生

### D-13: 死代码与死字段清理

| 项 | 位置 | 处理 |
|---|---|---|
| `_compiledMaterials` 字段仅声明与清空，从未写入 | `renderer-three/src/index.ts` | 删除 |
| `TourPlayer._destroyed` 置位后从未读取 | `core/src/tour-player.ts` | 删除或在 `load/switchScene` 中校验 |
| `tests/self-test.ts` 与 vitest 重叠，且其 `removeEventListener` mock 有 bug（`filter` 未写回，监听永不移除） | `tests/` | 用例迁入 vitest 后删除 |
| `decodeSpzInWorker` 导出仅为"向后兼容"但已不在主路径 | `renderer-three/src/index.ts` | WebGPU 路径改造（D-08）完成后评估下线 |

**预计成本：** 合计 0.5 天。

### D-14: 工程脚本跨平台修复（lint/typecheck/clean）

| 字段 | 内容 |
|---|---|
| **根因** | `pnpm lint` 的裸 glob、`pnpm typecheck` 的 `'./packages/*'` filter、`rm -rf` 在 Windows PowerShell 下全部失效（本次实测确认） |
| **影响** | Windows 开发者本地质量门禁形同虚设，只能依赖 CI |
| **修复方案** | 见优化文档 §4.1（引号 glob + `pnpm -r exec` + Node clean 脚本）；根 `package.json` 补 `"type": "module"` 消除 eslint.config.js 警告 |
| **预计成本** | 0.5 天 |

### D-15: 测试基础设施：免构建运行 + 覆盖缺口

| 字段 | 内容 |
|---|---|
| **根因** | 包 `exports` 指向 `dist/`，vitest 无法直接解析源码（实测未构建时 2 个测试文件加载失败）；`RenderManager` 主体（1200 行）、React/Vue 组件零测试 |
| **修复方案** | ① `vitest.config.ts` 添加 `@3dgs/*` → `src` 别名（优化文档 §4.2）；② 为 `RenderManager` 路由/降采样/注入逻辑补 mock 测试；③ 引入组件测试 |
| **预计成本** | 别名 0.5 天；补测 2-3 天 |

### D-16: 双后端重复的加载/降采样/进度代码

| 字段 | 内容 |
|---|---|
| **根因** | M4 债务已提取共享模块，但格式路由、降采样循环、流式进度读取仍各写一份（3 处降采样、4 处 fetch 进度） |
| **修复方案** | 抽取 `fetchWithProgress` / `downsampleSplatBytes` / 格式路由（优化文档 §4.3） |
| **预计成本** | 1 天 |

### D-17: `@3dgs/plugins` 缺少子路径导出

| 字段 | 内容 |
|---|---|
| **根因** | `package.json` exports 只有 `"."`，但代码注释/文档提及 `@3dgs/plugins/hotspot` |
| **影响** | 按子路径引入会解析失败；用户只能全量引入（不利 tree-shaking） |
| **修复方案** | 为每个插件目录声明子路径导出（`./hotspot`、`./scene-transition` 等）或统一口径只保留根导出并修正文档 |
| **预计成本** | 0.5 天 |

---

## 5. 存量债务复核（来自 `docs/Technical-Debt/technical-debt.md`）

| 编号 | 原状态 | 本次复核结论 |
|---|---|---|
| **L3** 移动端真机测试 | 待执行 | 仍未执行。建议结合 D-04（context restore）一并验证，移动端是 context lost 高发区 |
| **L4** 统一 FrustumCulling 两套实现 | 待执行 | 结论不变，与 D-01 合并实施（优化文档 §2.1+§2.2 是同一改造的两部分） |
| **L5** SOG v2 紧凑格式（29B）读取端验证 | 待执行 | ⚠️ **状态过时**：`SogStreamer.dequantizePositions` 已实现 29B 反量化（含 chunk local bbox）。应更新登记为"已实现，待端到端验证"——建议补一个"写入端 `positionQuant=1` → 读取端渲染"的 E2E 用例后关闭 |

---

## 6. 修复路线图

### 第一阶段：止血（1 周）
> 目标：消除崩溃与功能失效，恢复质量门禁

- D-02（SOG 崩溃）、D-03（CLI Buffer）、D-05（React 双加载）、D-06（Promise 反模式）
- D-14（脚本跨平台）、D-15-①（测试免构建）
- **验收：** fresh clone → `pnpm install && pnpm test` 全绿；`pnpm lint`/`pnpm typecheck` 在 Windows 实际执行

### 第二阶段：正确性收敛（2-3 周）
> 目标：双后端行为一致，承诺的功能真实可用

- D-01 + L4（索引管线与裁剪统一）、D-04（restore 循环）、D-09（相机朝向）
- D-07（fly/camera:defaults 落地或下线）、D-12（钩子语义文档化）
- **验收：** WebGPU 排序+裁剪联调测试通过；demo 双后端截图对比

### 第三阶段：兑现优化承诺（1 个月）
> 目标：已写好的优化真正生效，体积与内存下降

- D-10（BufferPool + SoA 接线）、D-11（预加载）、D-08（SPZ SH）、D-16（共享代码抽取）
- 配合优化文档 §2.3/§2.4/§3.3 的性能项
- **验收：** 池命中率 >0；5M splats 转换无需 8GB 堆；demo 首屏 gzip 体积 -50%

### 第四阶段：卫生与验证（持续）
- D-13（死代码）、D-15-②③（补测）、D-17（子路径导出）、L5 收尾、L3 真机测试

---

## 7. 防债务增长机制建议

1. **优化项"接线"闭环**：本次多项债务源于"优化代码写了但没接入"（BufferPool、SoA、预加载）。建议任何性能优化 PR 必须附带**生效证明**（基准对比或命中率统计），否则不予合并。
2. **事件契约登记**：`TourPlayer` 事件总线已出现多个无消费者事件（`transition:fly:frame`、`camera:defaults`）。建议在 core 中维护事件清单（发射方/消费方），新增事件必须成对出现。
3. **跨平台脚本校验**：CI 增加 Windows runner（或至少本地钩子）跑 `lint`/`typecheck`/`test` 三件套。
4. **实验性代码隔离**：`@experimental` 的 WebGPU 路径缺陷较多（D-01/08/09），建议其测试单独标记并纳入 CI 报告，与生产路径质量水位分开追踪。
