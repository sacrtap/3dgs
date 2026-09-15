# 数据转换链路优化执行计划

## Context

调研报告《数据转换能力实测评估与优化方案-2026-09-15》识别出 `packages/convert` 数据转换链路的两类高风险正确性缺陷（PLY 快路径 element 偏移错读、CRLF 头部偏移错读）与多项治理项（batch 输出碰撞、SH 跨格式丢失、CLI 走 AoS 高内存路径、coverage 门禁不可用等）。

本计划将报告中的 13 项问题（3.1–3.13）与排期补充项（SOG gzip level 9→6、info .spz）全部落为可执行的原子步骤，分三阶段：正确性修复 → CLI SoA 内存/性能 → 协议与工具卫生。每步含精确目标文件、符号、签名与验收断言。

### 核实结论（本计划已逐项对照源码确认）

- **13 项问题全部准确**，根因与修复方向与源码一致。关键行号已按当前工作区（`packages/convert/src/`）重定位，报告内引用的旧绝对路径 `/Users/sacrtap/Documents/project_work/3dgs/` 忽略。
- **codegraph 不可用**：工作区 `.codegraph/` 仅含 `.gitignore`，无索引。影响范围已改用 `grep`/`read` 精确排查，结果：`tryFastPathParsePly` 被 `loadGaussiansFromPly` 与 `loadGaussiansFromPlySoA`（`gaussian-loader.ts`）调用；`decodeSogToCloud` 仅被 cli.ts 内 `loadCloudFromAny`/`batchConvert` 调用；`shMode`（byte 54）被 `parseSogMetadata` 与 `renderer-three/src/sog-streamer.ts` 读取。
- **报告遗漏 1 项**：`decodeSogToCloud` 是 cli.ts 内部函数、未导出，公共 API 无 SOG body 读回入口（报告 2.1 提为"部分"状态但未列入修复清单）。本计划将其并入 3.5 修复，一次性落地公共 SoA 读回 API，避免"CLI 内部实现、公共 API 缺失"的割裂，同时为 3.6 的 SoA 切换提供原语。
- **3.1 修复需补一个报告未明示的边界**：若 `vertex` 之前的 element 含 list 属性（如 `face`），其字节长度是变长的，无法静态计算偏移——快路径必须回退 `null` 交给慢路径，而非尝试解析。

---

## Approach

### 阶段 A：正确性修复（P0/P1）

#### A1. 修复 CRLF PLY 头部偏移（报告 3.2）

文件 `packages/convert/src/ply-parser.ts`。

1. 将 `readLine(bytes: Uint8Array, offset: number): string` 改为返回 `{ text: string; nextOffset: number }`：
   - 扫描到 `0x0a`(`\n`)：`nextOffset = end + 1`。
   - 扫描到 `0x0d`(`\r`)：若 `end + 1 < bytes.length && bytes[end + 1] === 0x0a` 则 `nextOffset = end + 2`，否则 `nextOffset = end + 1`。
   - 未找到换行符（EOF）：`nextOffset = end`，`text` 为到末尾的子串。
   - `text = new TextDecoder().decode(bytes.subarray(offset, end))`。
2. 更新 `parsePlyHeader` 的两处调用（首行 `ply` 读取，及 while 循环内逐行读取）为 `const r = readLine(bytes, offset); line = r.text; offset = r.nextOffset;`，删除原有的 `offset += line.length + 1`。
3. 不触碰 `parseAsciiBody`（其 `split('\n')` + `trim()` 已能吞掉 `\r`，header 修复后其 `headerEnd` 自然对齐）。

新增回归：构造 CRLF 二进制 PLY（每行 `\r\n`，含 `end_header\r\n`），断言 `parsePlyHeader(...).headerEnd` 与同内容 LF 版一致，且 `loadGaussiansFromPly` 读出的首个顶点位置正确。

#### A2. 修复快路径 vertex element 偏移（报告 3.1）

文件 `packages/convert/src/ply-parser.ts`，函数 `tryFastPathParsePly`（约 443 行 `const view = new DataView(buffer, headerEnd)` 处）。

1. 在 `const count = vertexElement.count` 之后、分配 TypedArray 之前，计算 vertex 在 body 中的真实偏移：
   ```ts
   let vertexBodyOffset = 0;
   for (const el of header.elements) {
     if (el === vertexElement) break;
     // 前序 element 含 list 属性 → 变长，无法静态计算 → 回退慢路径
     if (el.properties.some((p) => p.isList)) return null;
     const elStride = el.properties.reduce((s, p) => s + DATA_TYPE_SIZE[p.type], 0);
     vertexBodyOffset += el.count * elStride;
   }
   ```
2. 将 `const view = new DataView(buffer, headerEnd)` 改为 `new DataView(buffer, headerEnd + vertexBodyOffset)`。
3. 分配前加边界校验：`if (headerEnd + vertexBodyOffset + count * stride > buffer.byteLength) return null;`（回退慢路径，慢路径会抛明确错误）。

新增回归：`element face 1 / property list uchar int vertex_indices` 在 `element vertex` 之前，断言 `loadGaussiansFromPly` 与 `loadGaussiansFromPlySoA` 结果与慢路径 `parsePly` 一致（首个顶点 `{x:1,y:2,z:3}`）。

#### A3. 修复 batch 输出路径碰撞（报告 3.3）

文件 `packages/convert/src/cli.ts`，函数 `batchConvert`。

1. `inputFiles` 在过滤后排序：`inputFiles.sort((a, b) => a.localeCompare(b))`（确定性）。
2. 新增 `const usedOutputs = new Set<string>()`，在循环内替换原 `file.replace(/\.(ply|splat|spz|sog)$/i, `.${format}`)` 逻辑：
   - 计算基准输出 `file.replace(/\.(ply|splat|spz|sog)$/i, '.' + format)`。
   - 若 `usedOutputs.has(base)`，则追加 `-1/-2/...` 后缀（在扩展名前，如 `bench-1000.spz` → `bench-1000-1.spz`），直到唯一。
   - 将最终唯一路径加入 `usedOutputs`，用于 `writeFile` 与 manifest 的 `output` 字段。
3. 保留单格式无碰撞时的原命名（`bench-1000.ply` → `bench-1000.spz`），避免破坏现有 C-10 batch 测试与下游约定。

新增回归：同目录放置 `bench-1000.ply/.splat/.spz`，`batch -f spz` 后输出目录含 3 个独立文件，manifest `files[].output` 互不重复。

#### A4. SOG v3 → SPZ 保留 SH + 落地公共 SoA 读回 API（报告 3.5 + 报告遗漏项）

新建文件 `packages/convert/src/sog-reader.ts`（对齐 `splat-reader.ts`/`spz-reader.ts` 命名惯例），复用 `parseSogMetadata`/`readShOverlaySoA`（`sog-writer.js`）、`SPLAT_BYTES_PER_SPLAT`（`splat-writer.js`）、`fromSoA`（`gaussian-loader.js`）、`gunzipSync`（`node:zlib`）。

1. `export function loadGaussiansFromSogSoA(buffer: ArrayBuffer, options?: { source?: string }): GaussianCloudSoA`：
   - `const meta = parseSogMetadata(buffer)`。
   - 逐 chunk 解码为列式 TypedArray（`positions/scales/rotations/colors/opacities`），完整移植 `cli.ts` 现有 `decodeSogToCloud` 的解码逻辑：`compact = meta.positionQuantization === 1` → 29B 布局（3×Uint24 量化位置 + 可选 24B chunk local bbox 前缀），否则 32B 布局；`meta.compression === 1` 时先 `gunzipSync`；chunk bbox 判定沿用 `data.byteLength >= expectedDataSize + 24`（不改为 `>`，避免 shMode=1 尾部 DC 误判，注释保留）。
   - `const sh = readShOverlaySoA(buffer, meta)`；若 `sh` 有值则 `shDegree = meta.shDegree`、`sh = sh`，否则 `shDegree = 0`、`sh = undefined`。
   - 返回 `{ count: meta.numSplats, shDegree, source: options?.source ?? 'sog', positions, scales, rotations, colors, opacities, sh }`。
2. `export function loadGaussiansFromSog(buffer: ArrayBuffer, options?: { source?: string }): GaussianCloud` = `fromSoA(loadGaussiansFromSogSoA(buffer, options))`。
3. 删除 `cli.ts` 的 `decodeSogToCloud`；`loadCloudFromAny` 与 `batchConvert` 的 `.sog` 分支改调 `loadGaussiansFromSog(...)`。
4. `index.ts` 导出 `loadGaussiansFromSog`、`loadGaussiansFromSogSoA`。

新增回归（`round-trip.test.ts`）：`generateBenchmarkPly(24, 1)` → `writeSogSoA(..., {version:3})` → `loadGaussiansFromSogSoA` 断言 `shDegree===1`、`sh.length === 24*9`、与源 SH 误差在 Int8 量化桶内；再 `writeSpzSoA` → `loadGaussiansFromSpzSoA` 断言 `shDegree===1`。

#### A5. 修正压缩 PLY SH 文档 + CLI 损失提示（报告 3.4）

1. 文件 `docs/Technical-Debt/c06-format-adaptation-research.md` §2.3 表第 40 行：`是 (C-05 已含 SH 量化)` 改为 `否 (仅 base attributes; SH 未写入)`。（已核实 `docs/` 下仅此一处声称压缩 PLY 含 SH，`convert-quality-analysis.md` 未涉及。）
2. 文件 `packages/convert/src/cli.ts` `to-compressed-ply` action：加载 cloud 后，若 `cloud.shDegree > 0`，打印 `⚠️ 压缩 PLY 不保留 SH: 源 SH degree ${cloud.shDegree} 将被丢弃`。

不实现压缩 PLY 的 SH element（SuperSplat 布局扩展 + writer/reader 双侧同步是独立协议变更，报告列为长期选项，本次不纳入）。

#### A6. 修复 coverage 超时（报告 3.13）

文件 `packages/convert/src/soa.test.ts` 跨分块用例（约 199 行，`count = (1 << 16) + 500`）。

将 5 个全量 `toEqual`（positions/scales/rotations/colors/opacities/sh）改为抽样断言：保留 `count`/`shDegree` 相等断言，对每个属性数组改断 `direct.positions[0] === viaAos.positions[0]`、`direct.positions[(count-1)*3] === viaAos.positions[(count-1)*3]`、以及中点索引，删除全量 `toEqual`。移除或保留 `20_000` 超时（抽样后远低于 20s，可去掉显式超时）。

---

### 阶段 B：CLI 全链路 SoA 化与性能

#### B1. 实现 `pruneGaussiansSoA`（报告 3.6 支撑项）

文件 `packages/convert/src/processing.ts`。

`export function pruneGaussiansSoA(soa: GaussianCloudSoA, options: PruneOptions = {}): GaussianCloudSoA`，与 `pruneGaussians` 语义逐项对齐：
- 第一阶段过滤（`removeInvalid`/`removeTransparent`/`minOpacity`/`maxScale`/`minScale`）对 TypedArray 逐项判断，收集 keep 索引 `Uint32Array`。
- 第二阶段 `contributionCutoff`：对 keep 索引计算 `score[i] = opacities[i] * max(scaleX,scaleY,scaleZ)`，复用 `quickselectIndices` 求 top-K 阈值，截断 keep 索引。`contributionCutoff >= 1` = 保留确切数量、`0<cutoff<1` = 保留比例（与 AoS 一致）。
- 按最终 keep 索引拷贝出新的 `GaussianCloudSoA`（`positions/scales/rotations/colors/opacities/sh`，`sh` 仅在源 `sh` 存在时按 `shDim = sh.length/count` 逐 splat 拷贝）。
- `index.ts` 导出 `pruneGaussiansSoA`。

新增测试（`processing.test.ts`）：`pruneGaussiansSoA` 与 `fromSoA(pruneGaussians(toSoA(cloud)))` 在 `--prune` 与 `contributionCutoff` 两种配置下逐 splat 等价。

#### B2. `convertCloud` 切换为 SoA（报告 3.6）

文件 `packages/convert/src/cli.ts`。

1. `convertCloud(cloud: GaussianCloud, ...)` 改为 `convertCloudSoA(soa: GaussianCloudSoA, opts, format, input, inputSize, startTime): Promise<number>`：
   - prune → `pruneGaussiansSoA`；`--max-splats` → `pruneGaussiansSoA(soa, { contributionCutoff: maxSplats, minOpacity: 0 })`。
   - sort → `mortonSortSoA`。
   - 写入：`writeSplatSoA` / `writeSpzSoA` / `writeSogSoA` / `writeCompressedPlySoA`（均为已存在的 SoA 写入，byte 级与 AoS 一致，见 4.3 已核实）。
   - 返回 `soa.count`（替换 `cloud.splats.length`）。
2. `convertPly` → `loadGaussiansFromPlySoA`；`convertSplat` → `loadGaussiansFromSplatSoA`；`to-compressed-ply` action → `loadGaussiansFromPlySoA`（或经 `loadCloudFromAny` 的 SoA 变体）。
3. `loadCloudFromAny` 改为 SoA 变体（`.ply`→`loadGaussiansFromPlySoA`、`.splat`→`loadGaussiansFromSplatSoA`、`.spz`→`loadGaussiansFromSpzSoA`、`.sog`→`loadGaussiansFromSogSoA`），SPZ 分支在 `batchConvert` 内直接 `loadGaussiansFromSpzSoA` 后调 `convertCloudSoA`。
4. 删除 cli.ts 内对 `loadGaussiansFromPly`/`loadGaussiansFromSplat`/`loadGaussiansFromSpz`/`decodeSogToCloud` 的 AoS 引用（clean cutover，不留别名）。

验收：`pnpm test -- packages/convert` 全绿；500k 合成 PLY 冒烟在常规堆上限完成（见 Verification）。

#### B3. SOG gzip 默认 level 6（报告排期补充 5.2.3）

文件 `packages/convert/src/sog-writer.ts`，`writeSogSoA`：`gzipSync(Buffer.from(rawChunkData), { level: 9 })` → `{ level: 6 }`。读取端 `gunzipSync` 对任意 level 兼容，round-trip 无需改动。

#### B4. `info .spz` 输出真实 header（报告 3.7）

文件 `packages/convert/src/cli.ts`，`showInfo` 的 `.spz` 分支：

```ts
const header = await parseSpzHeader(new Uint8Array(toArrayBuffer(buffer)));
console.log(`   类型: Niantic SPZ ${header.container === 'ngsp' ? `v${header.version} (NGSP+zstd)` : `v${header.version} (gzip)`}`);
console.log(`   高斯核数: ${header.numPoints.toLocaleString()}`);
console.log(`   SH 阶数: ${header.shDegree}`);
console.log(`   位置量化: ${header.fractionalBits} bits`);
```

顶部 import 增补 `parseSpzHeader`（`./spz-reader.js`，已导出）。删除 `(解压后可查看详细信息)`。

---

### 阶段 C：协议与工具卫生（P2）

#### C1. 统一 SOG v3 `shMode` 语义（报告 3.8）

文件 `packages/convert/src/sog-writer.ts`，`writeSogSoA`：

1. 在分块循环前先行计算 `hasShOverlay = isV3 && shDim > 0 && !!soa.sh`（现为后置计算，需前移到分块前）。
2. 当 `hasShOverlay` 为真：跳过 `appendShDcSoA`（chunk DC 冗余），主 header byte 54 写 `SOG_SH_MODE_FULL_INT8`(2)。
3. 否则：主 header byte 54 写 `shMode`（0 或 1），`shMode === SOG_SH_MODE_DC_INT8` 时照旧追加 chunk DC。
4. overlay header byte 9 保持 `SOG_SH_MODE_FULL_INT8`(2)。

文件 `packages/renderer-three/src/sog-streamer.ts`：更新 byte 54（`shMode`）语义注释与 chunk 解码分支——`0`=无、`1`=chunk 尾 3B DC、`2`=v3 完整 overlay（chunk 无 DC，SH 走文件尾 overlay）。同步核对 `sog-streamer.test.ts` 中 v3 用例的 shMode 断言。

新增测试：`sog-writer.test.ts` 断言 `writeSogSoA(soa, {version:3})`（soa 含 SH）后 `parseSogMetadata` 返回 `shMode===2` 且 chunk 数据无 DC 尾；`sog-streamer.test.ts` 断言 v3 元数据 shMode 解释。

#### C2. CLI 版本号对齐包版本（报告 3.9）

文件 `packages/convert/src/cli.ts`：

1. 顶部新增 `import { readFileSync } from 'node:fs'`；定义 `const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;`。
2. `.version('0.1.0')` → `.version(PKG_VERSION)`。
- 说明：源态（tsx）`import.meta.url` 为 `src/cli.ts`，编译态为 `dist/cli.js`，二者 `../package.json` 均解析到 `packages/convert/package.json`。

新增 CLI 冒烟（`cli.test.ts`）：`3dgs-convert --version` 输出 `0.4.0`。

#### C3. 发布包 engines 统一 `>=22`（报告 3.10）

6 个发布包 `package.json` 的 `engines.node`：`convert`、`core`、`plugins`、`react`、`renderer-three`、`vue`，`">=18"` → `">=22"`（已核实 6 处均为 `>=18`）。不改根 `package.json`（已是 `>=22` 权威声明）。

#### C4. SPZ writer JSDoc 对齐真实布局（报告 3.11）

文件 `packages/convert/src/spz-writer.ts`，`writeSpz` 的 JSDoc：删除 `返回 Header (未压缩) + Body (gzip 压缩)` 及整段 `★ M5 修复 ... 修复后仅压缩 body 部分, header 16 字节保持未压缩` 注释；改为 `整个文件为单个 gzip 流；解压后 = 16B header (magic/version/numPoints/shDegree/fractionalBits/flags/reserved) + 属性体 (positions→alphas→colors→scales→rotations→sh)`。（已核实：`writeSpzSoA` 实际 `return gzipCompress(u8)` 整文件压缩，reader `loadGaussiansFromSpzSoA` 走 `data[0..1]===0x1f 0x8b` 整文件解压分支，`container:'gzip'`。）

#### C5. tour `--title` 声明（报告 3.12）

文件 `packages/convert/src/cli.ts`，`generate-tour` 命令：`.option('--title <title>', '漫游标题 (默认 3DGS 漫游)')`。`generateTour` 内的 `opts.title` 读取保持不变。

热点三处字面量位置（`[0.5,1.5,-1.0]`/`[-0.5,1.5,-1.0]`/`[0.5,1.2,-1.0]`）保持原样：它们是"近似热点"的已知局限而非 bug，从任意场景文件（PLY/SPLAT/SPZ/SOG 四格式）计算 bbox 需引入逐格式解析，超出本计划范围，明确不做。

---

## Critical files & anchors

| 文件 | 锚点 | 理由 |
|---|---|---|
| `packages/convert/src/ply-parser.ts` | `readLine`(~95)、`parsePlyHeader`(~103)、`tryFastPathParsePly`(~443 `DataView(buffer, headerEnd)`) | A1/A2 两处偏移修复，改 readLine 契约影响 2 处调用 |
| `packages/convert/src/cli.ts` | `decodeSogToCloud`(~399)、`loadCloudFromAny`(~527)、`batchConvert`(~531 输出名)、`convertCloud`(~287)、`showInfo`(~762)、`generateTour`(~653)、`.version('0.1.0')`(~56) | A3/A4/B2/B4/C2/C5 集中地 |
| `packages/convert/src/sog-writer.ts` | `writeSogSoA`(~286 shMode 写入 ~466、overlay ~499)、`readShOverlaySoA`(~681)、`SogMetadata` 接口 | A4 读回、B3 gzip level、C1 shMode 语义 |
| `packages/convert/src/processing.ts` | `pruneGaussians`(~39)、`quickselectIndices`(~76)、`mortonSortSoA` | B1 语义对齐基准 |
| `packages/renderer-three/src/sog-streamer.ts` | `shMode`(~52 byte 54 读取 ~414/423) | C1 消费端语义同步 |

---

## Verification

前置：`pnpm install`（已装则跳过）；均在仓库根 `/Users/sacrtap/orca/workspaces/3dgs/convert-tools-opt` 执行。

1. **正确性回归**（每阶段 A 完成后）：
   - `pnpm test -- packages/convert` 全绿（含新增 ply-parser/round-trip/cli/sog-writer 用例）。
   - 具体新行为检查：
     - CRLF：`parsePlyHeader` 对 CRLF 与 LF 二进制 PLY 返回相同 `headerEnd`，首个顶点位置一致。
     - 快路径：`element face 1`（list）在 `vertex` 前，`loadGaussiansFromPly`/`loadGaussiansFromPlySoA` 与 `parsePly` 慢路径结果一致。
     - batch：`bench-1000.ply/.splat/.spz` → `batch -f spz` 输出 3 个独立文件，manifest `files[].output` 唯一。
     - SOG v3→SPZ：`generateBenchmarkPly(24,1)` → SOG v3 → SPZ round-trip，`shDegree===1`、`sh` 非空。
2. **coverage 门禁恢复**（A6 后）：`pnpm test:coverage` 全绿（原 `soa.test.ts` 跨分块用例不再 23s 超时）。
3. **SoA 切换等价性**（B2 后）：`pnpm test -- packages/convert`（含 `pruneGaussiansSoA` 等价用例）；`pnpm typecheck`、`pnpm lint`。
4. **内存冒烟**（B2 后）：`pnpm --filter @3dgs/convert build` 后，用 `apps/demo/public/demo1.ply`（991,089 splats）跑 `node packages/convert/dist/cli.js ply-to-spz apps/demo/public/demo1.ply -o /tmp/demo1.spz`，观察峰值堆显著低于 AoS（预期 SoA 路径堆增量 ≈ +14 MB/50 万量级，而非 AoS +311 MB/50 万），产物可被 `info` 正确读回 splat 数。
5. **info/version 冒烟**（B4/C2 后）：`node packages/convert/dist/cli.js info apps/demo/public/kitchen.spz` 输出真实 `numPoints`/`shDegree`；`node packages/convert/dist/cli.js --version` 输出 `0.4.0`。
6. **全仓回归**（全部阶段后）：`pnpm test`（46 文件全绿）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`。

---

## Assumptions & contingencies

- **batch 命名策略**：采用"排序 + 碰撞时追加 `-N` 后缀"（保守，单格式行为不变）。若实现时发现下游（demo/docs）依赖 `<base>.<format>` 的精确命名且无法接受后缀，改回报告方案一 `基准名.<源扩展>.<目标扩展>`（全量改名，需同步更新 C-10 batch 测试断言）。
- **压缩 PLY SH**：仅修文档 + CLI 提示，不实现 SH element。若用户要求真正保留 SH，需另行立项（writer/reader 双侧 + SuperSplat 布局扩展）。
- **tour 热点**：仅声明 `--title`，不从场景计算 bbox（四格式解析复杂度超出本计划）。若用户坚持 bbox 派生，需另立步骤。
- **C1 shMode 语义**：采用"v3 + overlay → 主 header shMode=2 且跳过 chunk DC"的互斥方案（报告方案二）。若 `renderer-three` 有第三方消费者依赖"byte 54=1 时 chunk 尾必有 3B DC"的旧语义，需在 C1 落地时于 `sog-streamer.ts` 保持对旧 v2 文件（shMode=1）的向后兼容读取（本计划已按此处理：v2 文件不写 overlay，shMode 语义不变）。
- **engines**：6 包统一 `>=22`。若某包（如 `react`/`vue`）下游有强约束必须 `>=18`，该包单独保留并在其 `package.json` 加注释记录理由（参照根 R-13 政策）。
