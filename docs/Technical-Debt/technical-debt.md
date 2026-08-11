# 技术债务登记

> **来源:** Party Mode 评审讨论 — 2026-08-09  
> **文档:** docs/3dgs-meeting.md  
> **维护原则:** 每项技术债务需记录根因、影响、优先级和预计解决成本

---

## 🔴 P0 — 紧急修复

### P0: SOG 性能回归修复 — 降采样 + LOD 恢复

| 字段 | 值 |
|------|------|
| **优先级** | P0 (紧急) |
| **状态** | ✅ 已解决, 2026-08-11 |
| **涉及文件** | `packages/renderer-three/src/index.ts` (buildLodNonBlocking + loadSceneWithSogFallback), `packages/renderer-three/src/device-tier.ts` (blurAmount), `apps/demo/index.html` (__switchFormat LOD 等待) |
| **根因** | 三重问题叠加: 1) M2 衍生跳过 `createLodSplats()` → LOD 消隐失效 2) SOG 加载路径未执行降采样 → 全量 splat 渲染 (5.83M vs 500K) 3) 基准测试未等待 LOD 就绪 → 采集窗口内 FPS 极低 |
| **影响** | Garden SOG FPS 从 27.0 暴跌至 2.0, 几乎不可用 |
| **解决方案** | **三重修复:** 1) 恢复 `createLodSplats()` 调用 (Option A), 即使有预建 LOD 也调用 WASM 以保消隐 2) SOG 加载路径添加降采样逻辑 (与 .splat 路径一致), 超过 `maxSplats` 时均匀降采样 3) 基准测试 `__switchFormat` 添加 LOD 就绪等待 (轮询 `isLodReady()`, 最多 120s) |
| **验证结果** | Garden SOG FPS P50: 2.0 → **60.0** (+2900%) ✅ 所有场景 SOG FPS 与 SPLAT 持平或接近 ✅ 307 项测试全部通过 |
| **基准对比** | 见下方基准对比表 |

**P0 基准对比表:**

| 场景 | 修复前 SOG | 修复后 SOG | SPLAT (参考) |
| --- | --- | --- | --- |
| Kitchen | 28.9 | 54.1 | 58.3 |
| Demo1 | 2.4 | 43.1 | 44.9 |
| StorySplat | 5.0 | 37.0 | 50.4 |
| Demo2 | 1.7 | 35.2 | 47.8 |
| Garden | 2.0 (崩溃) | **60.0** | 60.0 |

---

## 🟡 Medium — 架构治理（有计划时处理）

### M1: SogPagedSplats — 已删除 (方案 B)

| 字段 | 值 |
|------|------|
| **优先级** | Medium |
| **状态** | ✅ 已解决 — 方案 B (删除), 2026-08-11 |
| **涉及文件** | ~~`packages/renderer-three/src/sog-paged-splats.ts`~~ (已删除), ~~`packages/renderer-three/src/sog-paged-splats.test.ts`~~ (已删除), `packages/renderer-three/src/index.ts` (已清理死代码) |
| **根因** | **格式层面不兼容, 非 API 使用错误。** Spark PagedSplats 要求每个 chunk 解码结果包含 `extra.lodTree` (Uint32Array), 这是 Spark RAD 格式的预构建 LOD 树。`SplatPager.processFetched()` 将其放入 `lodTreeUpdates`, `SparkRenderer.consumeLodTreeUpdates()` 仅在 `if (lodTree && chunk === 0)` 时设置 `record.rootPage`。SOG 格式存储 Morton 排序的 .splat 数据, `unpackSplats()` 解码后 `extra.lodTree` 为 `undefined` → `rootPage` 永不设置 → mesh 被 `updateLodInstances` 永久排除 (`if (rootPage === void 0) return`) → 黑屏。 |
| **根因证据链** | [Spark 源码 spark.module.js:10474] `if (lodTree && chunk === 0) { record.rootPage = page; }` <br> [Spark 源码 spark.module.js:10559] `if (this.pager && mesh.paged && record.rootPage === void 0) { return instances2; }` <br> [Spark 类型 defines.d.ts:63] `PackedExtra.lodTree?: Uint32Array` (仅 RAD 格式提供) <br> [Spark 源码 spark.module.js:12011] `lodTree: extra.lodTree` (从 fetchDecodeChunk 返回值提取) |
| **决策理由** | 方案 A (debug) 需在 SOG chunk 中嵌入 Spark LOD 树 (关联 M2) 或运行时用 Spark WASM 构建 LOD 树 (深度耦合内部实现), 均为新功能开发而非 debug。SogPagedSplats 为完全死代码 (未 import/未 export/未使用), 双 Mesh fallback 已验证可靠。 |
| **已执行操作** | 1) 删除 `sog-paged-splats.ts` (363 行) + `sog-paged-splats.test.ts` (461 行) 2) 移除 `index.ts` 中死代码 `positionCameraToBoundsFromMetadata()` 3) 更新 `loadSceneWithSog` 注释, 记录完整根因 4) 保留 `device-tier.ts` 中 `maxPagedSplats`/`numLodFetchers` (仍用于 SparkRenderer LOD 配置) |
| **后续关联** | 若未来需增量加载, 需先完成 M2 (SOG LOD 树预构建写入端), 在 SOG chunk 中嵌入 Spark 兼容的 LOD 树数据 |

---

### M2: SOG LOD 树预构建写入端实现

| 字段 | 值 |
|------|------|
| **优先级** | Medium |
| **状态** | ✅ 已解决 — SOG 原生 LOD 索引, 2026-08-11 |
| **涉及文件** | `packages/convert/src/sog-writer.ts` (写入端 + 序列化), `packages/renderer-three/src/sog-streamer.ts` (读取端), `packages/convert/src/index.ts` (导出), `packages/convert/src/sog-writer.test.ts` (测试) |
| **根因** | P1-3 目标"SOG 预构建 LOD 树"。SOG v2 格式已预留 `lodTreeOffset` (Uint32) 和 `lodTreeSize` (Uint32) 字段，但原方案计划调用 Spark 的 `createLodSplats` 生成 LOD 数据并序列化。经源码深度分析发现此方案不可行 (见下文)。 |
| **技术分析** | **Spark lodTree 不可序列化的根因:** 1) `lodTree` 是 WASM 内部不透明 `Uint32Array`, 格式由 WASM 二进制定义, 未公开, 随版本可能变化 [Spark 源码 spark.module.js:10527 `splats.extra.lodTree.slice()`] 2) Spark 无导出/序列化 API (无 `exportLodTree`/`serializeLod` 方法) 3) `createLodSplats` 依赖浏览器 API (Web Worker, THREE.js DataArrayTexture, Blob), 无法在 Node.js (convert 包运行环境) 中执行 [Spark 源码 spark.module.js:14791 `workerPool.withWorker()`] 4) `lodTree` 与 `lodSplats.packedArray` 耦合: 两者均由 WASM `to_packedsplats_lod()` 同时产生, 由 `initLodTree()` 同时消费, 不可单独使用 |
| **解决方案** | **SOG 原生 LOD 索引格式** — 不依赖 Spark WASM 内部结构, 在离线转换阶段预计算 LOD 层级边界: 1) `buildLodLevels(numSplats, numLevels, lodBase)` 基于 Morton 排序前缀子集计算 LOD 层级 (level i 的 splat 数 ≈ numSplats / lodBase^(numLevels-1-i)) 2) `serializeLodTree(levels, lodBase)` 序列化为二进制 (8B header + numLevels×4B) 3) `writeSog()` 在 chunk data 后追加 LOD 树数据, 更新 `lodTreeOffset`/`lodTreeSize` 4) `SogStreamer.parseLodTree()` 通过 HTTP Range 请求读取 LOD 树数据 5) `parseSogMetadata()` 解析 LOD 层级到 `metadata.lodLevels` |
| **LOD 格式** | `numLevels: Uint32` + `lodBase: Float32` + `levels: numLevels × Uint32` (累计 splat 数)。基于 Morton Z-order 的前缀子集保证空间均匀覆盖。`lodBase=1.75` (quality) 或 `1.5` (fast), 对应 Spark `createLodSplats` 的 `lodBase` 参数 [Spark 源码 spark.module.js:14783] |
| **向后兼容** | ✅ v1 文件无 LOD 字段, `lodTreeOffset=0` ✅ v2 文件 `buildLodTree=false` 时 `lodTreeOffset=0` ✅ `numSplats <= 100` 时不构建 LOD 树 ✅ LOD 树读取失败不阻断加载, 回退运行时构建 |
| **已执行操作** | 1) 新增 `buildLodLevels()`, `serializeLodTree()`, `deserializeLodTree()` 函数 2) 更新 `writeSog()` 支持 `buildLodTree`/`lodLevels` 选项 (默认 true/4) 3) 更新 `parseSogMetadata()` 解析 LOD 层级到 `lodLevels`/`lodBase` 字段 4) 更新 `SogStreamer` 添加 `parseLodTree()` 方法, 通过 Range 请求读取 LOD 树 5) 更新 `SogMetadata` 接口 (写入端 + 读取端) 添加 `lodLevels`/`lodBase`/`lodTreeOffset`/`lodTreeSize` 6) 新增 49 项测试 (写入/读取 round-trip, 单调性, 边界条件, 组合测试, 序列化 round-trip) |
| **验证结果** | ✅ 298 项测试全部通过 (原 198 + 新增 100) ✅ TypeScript 类型检查通过 (convert + renderer-three) ✅ 向后兼容: v1/v2 旧文件正常解析 |
| **后续关联** | ✅ 衍生完成: 客户端 LOD 驱动集成 (`buildLodNonBlocking` 读取 `metadata.lodLevels`), `getSogLodLevels()`/`getSogLodBase()` 访问器已暴露。⚠️ P0 修复: 跳过 `createLodSplats()` 导致 LOD 消隐失效, 已恢复调用 (Option A), 预建 LOD 仅作质量提示 |

---

### M4: 提取共享基类 — 减少 WebGPU 路径重复代码

| 字段 | 值 |
|------|------|
| **优先级** | Medium |
| **状态** | ✅ 阶段 1+2 均已完成, 2026-08-11 |
| **涉及文件** | `packages/renderer-three/src/keyboard-controls.ts` (新增), `packages/renderer-three/src/frame-callback-manager.ts` (新增), `packages/renderer-three/src/camera-matrix-cache.ts` (新增), `packages/renderer-three/src/index.ts` (重构), `packages/renderer-three/src/webgpu-render-manager.ts` (重构+阶段2), `packages/renderer-three/src/wgsl-shader-utils.ts` (新增), 5 个测试文件 (新增/更新) |
| **根因** | `WebGPURenderManager` 和 `RenderManager` (WebGL2+Spark) 各自独立实现了: 键盘移动控制 (WASD+QE)、自适应分辨率 (AdaptiveResolution)、拖拽控制 (DragLookControls)、Shader 注入。两套代码大量重复。 |
| **重复代码量化** | **~215 行重复代码:** 1) 键盘控制 (~130 行) 2) AdaptiveResolution 集成 (~30 行) 3) DragLookControls (~10 行) 4) 相机矩阵更新 (~20 行) 5) 帧回调 (~10 行) 6) 设备分级集成 (~15 行) |
| **WebGPU 缺失功能 (阶段 2 已修复)** | 1) **LOD 支持** — `_lodReady` 恒 false, 无 `createLodSplats()` 调用 2) **SOG/SPZ 格式** — ✅ 已支持 (SogStreamer + decodeSpzInWorker 集成) 3) **SparkRenderer 特性** — 无 `blurAmount`/`minAlpha`/`focalAdjustment` 等 4) **Context lost/restore** — 仅部分 GPU device lost 处理 5) **SplatBufferPool** — 无缓冲池 6) **Shader 注入** — ✅ 已功能化 (WGSL 注入工具 + 管线重建 + onUpdate) |
| **WGSL 着色器问题 (阶段 2 已修复)** | 1) ✅ 协方差投影: 简化近似 → 正确 EWA 投影 (view-space 协方差 + 透视 Jacobian) 2) ✅ 投影变换 Jacobian: 已实现 3) ✅ Fragment 高斯衰减: 简化圆形 → 正确椭圆 2D Gaussian (conic 矩阵) 4) 无 back-to-front 排序保证 (WebGPUSortManager 已排序) |
| **WebGPU 独有功能** | 1) GPU compute 排序 (`WebGPUSortManager`, compute shader) 2) 原生 WebGPU 渲染 (WGSL, 直接 GPU buffer) 3) 内置视锥裁剪 |
| **影响** | WebGPU 路径的维护成本高——任何共享功能的修改需要同步两处。当前 WebGPURenderManager 已标记为 `@experimental`，但重复代码已在阶段 1 消除。 |
| **方案** | **分两阶段执行:** **阶段 1 (✅ 已完成):** 提取可组合工具模块 (无继承耦合): `KeyboardControls`, `FrameCallbackManager`, `CameraMatrixCache`。**阶段 2 (✅ 已完成):** WGSL 着色器修复 (EWA 投影) + SOG/SPZ 格式支持 + Shader 注入功能化 (WGSL 注入工具 + 管线重建 + onUpdate 回调)。 |
| **阶段 2 详细内容** | **P2.1 WGSL 着色器修复:** 1) Uniform buffer 128B → 192B (新增 viewMatrix 64B + focal 8B) 2) 顶点着色器: 3D 协方差 → view-space 变换 → 透视 Jacobian → 2×2 屏幕协方差 → 低通滤波 (blur=0.3) → conic (逆协方差) → 特征值 → quad 尺寸 3) 片段着色器: 正确 2D 椭圆高斯 `exp(-0.5 * power)` (conic 矩阵) 4) 新增 conic varying (vec3) 从 vertex 传递到 fragment **P2.2 格式支持:** 1) `loadScene()` 格式路由 (.splat/.sog/.spz + lodSource) 2) `loadSceneWithSplat()`: 原有 .splat 加载逻辑 3) `loadSceneWithSpz()`: fetch → decodeSpzInWorker → parseSplatData 4) `loadSceneWithSog()`: SogStreamer 并行加载 → concatChunksInWorker → parseSplatData 5) SOG LOD 元数据缓存 (getSogLodLevels/getSogLodBase) **P2.3 Shader 注入功能化:** 1) 新增 `wgsl-shader-utils.ts`: WGSL 代码注入工具 (injectWgslAfterMainBegin/injectWgslBeforeMainEnd/injectWgslBeforePattern/inferWgslType) 2) `createRenderPipeline()` 应用注入到 WGSL 源码 3) `addShaderInjection()`/`removeShaderInjection()` 触发管线重建 4) 帧循环调用 `onUpdate` 回调更新 injection uniforms 5) 支持 6 个 ShaderHookPoint 映射到 WGSL 插入点 |
| **已执行操作** | **阶段 1:** 1) 新增 `keyboard-controls.ts`, `frame-callback-manager.ts`, `camera-matrix-cache.ts` 2) 重构 `index.ts` + `webgpu-render-manager.ts` 使用共享模块 3) 35 项测试 **阶段 2:** 1) 修改 `webgpu-render-manager.ts`: WGSL EWA 着色器 + 格式路由 + Shader 注入功能化 2) 新增 `wgsl-shader-utils.ts` 3) 更新 `webgpu-render-manager.test.ts`: 16 项新测试 4) 新增 `wgsl-shader-utils.test.ts`: 16 项测试 |
| **验证结果** | ✅ 411 项测试全部通过 (原 379 + 新增 32) ✅ TypeScript 类型检查通过 ✅ Linter 零错误 ✅ 行为等价: 键盘移动/帧回调/相机矩阵与重构前完全一致 |
| **预计成本** | 阶段 1: ✅ 已完成 (0.5 天) / 阶段 2: ✅ 已完成 (实际 0.5 天) |
| **前置条件** | **阶段 1:** 无 ✅ **阶段 2:** WebGPURenderManager 的 API 稳定 ✅ (WGSL 着色器修复 + 格式支持完善 + Shader 注入功能化) |

---

### M5: SPZ Writer gzip 压缩 Bug — 整文件压缩导致 magic 不匹配

| 字段 | 值 |
|------|------|
| **优先级** | Medium |
| **状态** | ✅ 已解决, 2026-08-11 |
| **涉及文件** | `packages/convert/src/spz-writer.ts` (写入端, M5 修复), `packages/renderer-three/src/spz-decoder-worker.ts` (读取端), `packages/convert/src/spz-writer.test.ts` (新增测试) |
| **根因** | `writeSpz()` 在 line 179 执行 `return gzipCompress(u8)`，将**整个 buffer** (header + body) 用 gzip 压缩。但 SPZ v2 格式规范 (同一文件头部注释) 明确要求: `Header (16 bytes, 未压缩)` + `Body (gzip compressed)`。解码器 `decodeSpz()` 期望前 16 字节为未压缩的 SPZ header，其余为 gzip 压缩的 body。 |
| **根因证据链** | [项目源码 — spz-writer.ts:178-179] `// ── Gzip compress entire buffer ──` / `return gzipCompress(u8);` (压缩整个 buffer) <br> [项目源码 — spz-writer.ts:5-6] 注释: `Header (16 bytes):` / `Body (gzip compressed, ...)` (规范要求 header 不压缩) <br> [项目源码 — spz-decoder-worker.ts:134-137] `const header = parseSpzHeader(data);` / `validateSpzHeader(header);` (从未压缩数据读 header) <br> [项目源码 — spz-decoder-worker.ts:142-143] `const compressedBody = new Uint8Array(data, SPZ_HEADER_SIZE);` / `const decompressed = await gzipDecompress(compressedBody);` (从 offset 16 开始解压 body) |
| **影响** | 1) 所有由 `writeSpz()` 生成的 `.spz` 文件，前 4 字节为 gzip magic (`1f 8b 08 00`) 而非 SPZ magic (`50 47 48 53`) 2) `validateSpzHeader()` 抛出 `magic 不匹配 (0x88b1f)` (gzip magic `0x00088b1f` 的 LE uint32) 3) `loadSceneWithSpz()` 捕获错误后回退到 Spark URL 直接加载 4) Spark 原生 SPZ reader 可正确解析 (内部先整体解压)，但**不走 maxSplats 降采样路径** → 大场景全量渲染 |
| **性能影响** | Garden SPZ (5.83M): FPS P50 = 2.0 (全量渲染 5.83M splats) vs 预期 60.0 (降采样至 500K)。Demo2 SPZ (3.97M): 8.4 FPS vs 预期 ~35。Kitchen SPZ (248K < maxSplats): 58.6 FPS (不受影响，因 248K < 500K 无需降采样)。 |
| **方案** | 修改 `writeSpz()`: 仅压缩 body 部分 (header 之后的数据)，不压缩 header。代码见下方 |
| **已执行操作** | 1) `spz-writer.ts:178-183`: 替换 `return gzipCompress(u8)` 为 header+compressedBody 拼接 2) 更新 JSDoc 注释说明格式 3) 新增 `spz-writer.test.ts` (15 项测试): header magic 校验, header 字段正确性, body gzip 压缩验证, body 解压 round-trip, parseSpzHeader 兼容性, 边界条件 |
| **验证结果** | ✅ 前 4 字节为 SPZ_MAGIC (0x50474853), 非 gzip magic ✅ Header 16 bytes 全部未压缩, 字段值正确 ✅ Body (offset 16+) 为 gzip 压缩数据 (0x1f 0x8b 开头) ✅ Body 解压后大小和数据正确 (position/alpha/SH) ✅ parseSpzHeader 可正确解析 ✅ 344 项测试全部通过 (15 个测试文件) |
| **预计成本** | 0.5 天 (实际完成) |
| **前置条件** | 无 |
| **关联** | 基线 3 已知问题: "SPZ 大场景仍卡顿 — Garden SPZ FPS P50=2.0，SPZ Worker 解码失败回退到 URL 直接加载，全量渲染无降采样" (待重新生成 .spz 文件后验证 FPS) |

**M5 修复代码:**

```typescript
// 修改前 (bug):
return gzipCompress(u8);

// 修改后 (fix):
const headerBytes = u8.slice(0, headerSize);
const compressedBody = await gzipCompress(u8.slice(headerSize));
const result = new Uint8Array(headerSize + compressedBody.length);
result.set(headerBytes, 0);
result.set(compressedBody, headerSize);
return result;
```

---

## 🟢 Low — 长期优化

### L1: 研究 Spark 未使用特性

| 字段 | 值 |
|------|------|
| **优先级** | Low |
| **状态** | ✅ 已完成研究 + blurAmount/minAlpha/focalAdjustment 已实施, 2026-08-11 |
| **涉及文件** | `packages/renderer-three/src/index.ts` (SparkRenderer 配置), `packages/renderer-three/src/device-tier.ts`, `packages/renderer-three/src/device-tier.test.ts` |
| **根因** | Spark v2.1.0 有多个未使用的特性参数: `sortRadial` (排序方向)、`preBlurAmount`/`blurAmount` (3DGS 抗锯齿)、`enable2DGS` (2D 高斯)、`splatEncoding` (编码格式)、`lodSplatCount`。当前项目关了 MSAA 但无替代抗锯齿方案。 |
| **影响** | `blurAmount` 可能是 MSAA 的低成本替代，提供边缘平滑。`sortRadial` 可能影响排序稳定性。 |

#### 研究结果

**来源:** [Spark 类型 — `node_modules/@sparkjsdev/spark/dist/types/SparkRenderer.d.ts`]

**当前已使用的 Spark 选项 (12 项):**
- `renderer`, `enableLod`, `lodSplatScale`, `lodRenderScale`, `maxStdDev`, `minPixelRadius`, `clipXY`, `minSortIntervalMs`, `coneFov0/coneFov/coneFoveate/behindFoveate`, `maxPagedSplats`, `numLodFetchers`

**未使用选项分析 (按价值排序):**

| 参数 | 默认值 | 描述 | 评估 | 建议 |
|------|--------|------|------|------|
| `blurAmount` | undefined | 抗锯齿模糊, 典型值 0.3 (≈0.5 像素半径) | ★★★ 高价值 — MSAA 的低成本替代, 我们已关闭 MSAA | 添加到 tier settings, HIGH/ULTRA 设为 0.3 |
| `minAlpha` | 0.5/255 | 最小 alpha 渲染阈值 | ✅ 已实施 — LOW=5/255, MEDIUM=2/255, HIGH=1/255, ULTRA=0.5/255 | 已添加到所有 tier settings |
| `focalAdjustment` | 1.0 | 投影 splat 缩放校正值, 越大越锐利 | ✅ 已实施 — LOW/MEDIUM=1.0, HIGH=1.5, ULTRA=2.0 (匹配 PlayCanvas) | 已添加到所有 tier settings |
| `lodInflate` | false | 膨胀 LOD splat 保持不透明度 ≤1.0 | ★☆☆ 低价值 — 仅在 LOD 生效时有意义 | M2 衍生完成后可测试 |
| `maxPixelRadius` | 512.0 | 最大像素半径上限 | ★☆☆ 低价值 — 限制大 splat, 但当前无大 splat 问题 | 暂不调整 |
| `falloff` | 1.0 | 高斯核衰减 (0=平面着色, 1=标准高斯) | ★☆☆ 低价值 — 艺术效果, 非性能 | 暴露为 shader 参数 |
| `lodRaycast` | 10000-25000 | 射线检测 LOD splat 数 | ★☆☆ 低价值 — 用于交互 (点击 splat) | 热点插件需要时启用 |
| `sortRadial` | true | 径向排序 vs Z 深度排序 | ✅ 已使用默认值 (true) — 径向排序在旋转时更稳定 | 无需修改 |
| `enable2DGS` | false | 2D 高斯泼溅模式 | ❌ 不适用 — 我们的场景是 3DGS, 非 2DGS | 跳过 |
| `preBlurAmount` | 0.0 | 2D splat 协方差预模糊 | ❌ 不适用 — 依赖 `enable2DGS` | 跳过 |
| `focalDistance`/`apertureAngle` | 0.0 | 景深效果 | ❌ 艺术效果, 非性能 | 跳过 |
| `encodeLinear` | false | 线性 RGB 编码 (环境映射) | ❌ 仅用于环境映射工作流 | 跳过 |
| `covSplats` | false | 协方差编码 | ❌ 需特殊打包数据, 与 .splat 格式不兼容 | 跳过 |
| `target` | undefined | 离屏渲染目标 | ❌ 用于环境贴图/多视角 | 跳过 |

**关键发现:**

1. **`blurAmount` 是最有价值的未使用特性** — 它是 Spark 内置的抗锯齿方案, 通过向 splat 协方差对角线添加标量值实现模糊+放大, 同时调整不透明度。由于我们已关闭 MSAA (`antialias: false`, Spark 官方建议), `blurAmount` 可作为边缘平滑的低成本替代。典型值 0.3 适用于使用抗锯齿训练的场景。

2. **`sortRadial` 默认值 (true) 已是最佳选择** — 径向排序在视角旋转时更稳定, 而 Z 深度排序在大多数场景训练时使用但在旋转时可能出现排序错误。无需修改。

3. **`lodSplatCount` vs `lodSplatScale`** — 我们使用 `lodSplatScale` (缩放因子) 而非 `lodSplatCount` (绝对值), 这更灵活, 无需修改。

| **预计成本** | 已完成 (0.5 天研究 + 1 天实施) |
| **已执行操作** | **blurAmount (已完成):** 1) `device-tier.ts`: 添加 `blurAmount` 字段 2) LOW=0.1, MEDIUM=0.2, HIGH/ULTRA=0.3 3) `index.ts`: SparkRenderer 传入 `blurAmount` 4) 9 项测试 **minAlpha (衡生实施):** 1) `device-tier.ts`: 添加 `minAlpha` 字段 2) LOW=5/255 (激进裁剪), MEDIUM=2/255, HIGH=1/255, ULTRA=0.5/255 (Spark 默认) 3) `index.ts`: SparkRenderer 传入 `minAlpha` 4) 9 项测试 (递减校验 + 各 tier 精确值) **focalAdjustment (衡生实施):** 1) `device-tier.ts`: 添加 `focalAdjustment` 字段 2) LOW/MEDIUM=1.0 (Spark 默认), HIGH=1.5 (中等锐化), ULTRA=2.0 (匹配 PlayCanvas) 3) `index.ts`: SparkRenderer 传入 `focalAdjustment` 4) 9 项测试 (递增校验 + 各 tier 精确值) |
| **风险** | `blurAmount` 在 3DGS 路径中生效 (非仅 2DGS), 通过 vertex shader 添加到 2D 协方差对角线 [来源: Spark 源码 spark.module.js splatVertex_default] |

---

### L2: 修复基准测试测量伪影

| 字段 | 值 |
|------|------|
| **优先级** | Low |
| **状态** | ✅ 已解决, 2026-08-11 |
| **涉及文件** | `apps/demo/index.html` (benchmark 采集逻辑), `benchmarks/run-benchmark.mjs` (报告生成) |
| **根因** | `05-性能基准报告.md` 第 3.2 节记录: 移动状态 Avg FPS 虚高 (119-123)，原因是"键盘事件触发 RAF 回调合并，部分帧时间极短 (3-8ms)，拉高平均值"。P50 是 60 FPS 但 Avg 是 120 FPS。此外 headless Chrome 不支持 COOP/COEP，排序回退主线程，所有 headless 基准数据低估真实性能。 |
| **影响** | 基准测试数据不准确，无法可靠评估优化效果。Avg FPS 指标不可信。 |
| **已执行操作** | 1) `recordFrame()` 中过滤 dt < 3ms 的 RAF 合并伪影帧 2) `computeStats()` 修复 `ftStd` 计算 (原使用 `fpsAvg` 而非帧时间均值) 3) 报告表格 P50/P5 列移至 Avg 之前 4) 报告添加说明标注 "P50/P5 为主要指标, Avg 仅作参考" 5) 控制台输出格式调整为 P50 优先 |

---

### L3: 移动端真机测试

| 字段 | 值 |
|------|------|
| **优先级** | Low |
| **状态** | 待执行 |
| **涉及文件** | 无（需要物理设备） |
| **根因** | 当前所有性能数据来自桌面 Chrome (macOS)。无 iOS Safari 和 Android Chrome 的真机性能数据。移动端是 3DGS 渲染的关键场景（集显设备 + 有限内存 + WebGL context lost 高发）。 |
| **影响** | 移动端性能基线未知，无法确认 P0 优化（注视点渲染、排序节流）在移动端的实际效果。设备分级 (LOW tier) 的参数可能需要调整。 |
| **方案** | 1) 在 iPhone (Safari) 和 Android (Chrome) 上运行 demo；2) 使用 Chrome Remote Debugging 采集性能数据；3) 记录各设备 tier 的 FPS/加载时间/内存使用；4) 根据真机数据调整 `device-tier.ts` 的 LOW/MEDIUM 参数。 |
| **预计成本** | 2-3 天（含设备准备 + 测试 + 参数调整） |
| **前置条件** | 需要 iOS 和 Android 真机设备。 |

---

### L4: 统一 FrustumCulling 两套实现

| 字段 | 值 |
|------|------|
| **优先级** | Low |
| **状态** | 待执行 |
| **涉及文件** | `packages/renderer-three/src/frustum-culling.ts` (SpatialGrid 批量裁剪), `packages/renderer-three/src/webgpu-render-manager.ts` (`performFrustumCull()` 逐 splat 点测试, lines 1032-1083) |
| **根因** | 项目中存在两套独立的视锥裁剪实现: 1) `FrustumCulling` 类 (基于 Morton 空间分块的 `SpatialGrid`, 8×8×8 = 512 cells, 批量 `frustum.intersectsBox()` 测试, 复杂度 O(G)) 2) `WebGPURenderManager.performFrustumCull()` 方法 (逐 splat 中心点 `frustum.containsPoint()` 测试, 复杂度 O(N))。两套实现独立运行, 无代码复用。 |
| **影响** | `WebGPURenderManager` 的逐 splat 点测试在大场景 (1M+ splats) 中每 3 帧遍历全部 splat 中心点, 性能低于 `SpatialGrid` 的批量分块方案。此外, 两套实现增加维护成本, 任何裁剪逻辑修改需同步两处。 |
| **方案** | 将 `WebGPURenderManager.performFrustumCull()` 替换为使用 `FrustumCulling` 类 (基于 `SpatialGrid`): 1) `loadScene` 完成后构建 `FrustumCulling` 实例 (传入 splat 数据 + 包围盒) 2) 每帧使用 `getVisibleRanges()` 获取可见 splat 范围 3) 将范围转为 GPU index buffer 写入 4) 删除 `performFrustumCull()` 中的逐 splat 循环 |
| **预计成本** | 0.5 天 |
| **前置条件** | `FrustumCulling` 类需支持从 `Float32Array` (positions only) 构建, 当前仅支持 `Uint8Array` (.splat 格式) |

---

### L5: SOG v2 紧凑格式 (29 字节) 读取端验证

| 字段 | 值 |
|------|------|
| **优先级** | Low |
| **状态** | 待执行 |
| **涉及文件** | `packages/convert/src/sog-writer.ts` (写入端, positionQuant=1 时使用 29 字节紧凑格式), `packages/renderer-three/src/sog-streamer.ts` (读取端, chunk 数据解析) |
| **根因** | SOG v2 格式定义了 `positionQuant` 字段: 当 `positionQuant=1` 时, chunk 内每个 splat 使用 29 字节紧凑格式 (Position: 3×Uint24 LE = 9 bytes, Scale: 3×Float32 = 12 bytes, Color: 4×Uint8 = 4 bytes, Rotation: 4×Uint8 = 4 bytes), 比标准 32 字节 .splat 格式小 9%。写入端 `writeSog()` 已实现紧凑格式写入, 但读取端 `SogStreamer` 的 chunk 数据解析仍按 32 字节 .splat 格式处理, 未实现 29 字节紧凑格式的反量化读取。 |
| **影响** | 使用 `positionQuant=1` 生成的 SOG v2 文件, 在客户端加载时 chunk 数据会被错误解析 (按 32 字节切分 29 字节数据), 导致位置/缩放/颜色/旋转全部错位。当前生成的 SOG 文件均使用 `positionQuant=0` (标准 32 字节格式), 因此不影响现有功能, 但未来启用紧凑格式时会出错。 |
| **方案** | 1) `SogStreamer` 的 chunk 解析逻辑添加 `positionQuant` 判断 2) 当 `positionQuant=1` 时, 使用 29 字节紧凑格式解析: Position 反量化 `pos = min + (uint24 / 0xFFFFFF) * range` 3) 新增测试: 生成紧凑格式 SOG v2 文件 → 读取 → 验证数据正确性 4) 验证 gzip 压缩 + 紧凑格式的组合场景 |
| **预计成本** | 1 天 (含测试编写) |
| **前置条件** | 无 |

---

## 债务追踪

| 编号 | 优先级 | 状态 | 最后更新 |
|------|--------|------|---------|
| P0 | P0 | ✅ 已解决 (SOG 降采样 + LOD 恢复) | 2026-08-11 |
| M1 | Medium | ✅ 已解决 (方案 B 删除) | 2026-08-11 |
| M2 | Medium | ✅ 已解决 (SOG 原生 LOD 索引) + 衍生: 客户端 LOD 驱动集成 + P0 修复 | 2026-08-11 |
| M4 | Medium | ✅ 阶段 1+2 均已完成 (共享模块 + EWA 着色器 + 格式支持 + Shader 注入, 411 全通过) | 2026-08-11 |
| M5 | Medium | ✅ 已解决 (SPZ Writer gzip 压缩修复 + 15 项测试) | 2026-08-11 |
| L1 | Low | ✅ 已完成研究 + blurAmount/minAlpha/focalAdjustment 实施 | 2026-08-11 |
| L2 | Low | ✅ 已解决 (RAF 过滤 + P50/P5 优先) | 2026-08-11 |
| L3 | Low | 待执行 | 2026-08-09 |
| L4 | Low | 待执行 (统一 FrustumCulling 两套实现) | 2026-08-11 |
| L5 | Low | 待执行 (SOG v2 紧凑格式读取端验证) | 2026-08-11 |
