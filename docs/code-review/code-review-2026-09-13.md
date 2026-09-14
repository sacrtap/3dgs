Review partially complete: 45 finding(s); 10 of 44 selected item(s) failed.

─── package.json:37-37 ───
> ✅ 已修复 (2026-09-13): 新建 apps/r3f-example/tsconfig.json + 添加 typescript devDep, 根 typecheck 排除列表移除 r3f-example; 修掉 TS5097 import 路径错误
[maintainability · medium] 将 `@3dgs/r3f-example` 从 typecheck 流程中排除后，该包内的 TypeScript 类型错误将不再被 CI
捕获。查看该包目录发现它包含 `src/main.tsx` 和 `src/overlay.tsx` 两个 TSX 源文件，但既没有 `tsconfig.json` 也没有 `typescript`
devDependency，因此也无法独立运行类型检查。

建议：为该包补充 `tsconfig.json`（可继承根配置）并在 devDependencies 中添加 `typescript`，然后将其从排除列表中移除；或者至少在 package.json
的 scripts 中添加 `"typecheck": "tsc --noEmit"` 并在 CI 中单独执行，以确保示例代码的类型安全不会被长期忽视。



─── apps/r3f-example/src/overlay.tsx:15-18 ───
> ✅ 已修复 (2026-09-13): Vector3 提升为模块级 `_dir` 复用, useFrame 不再每帧分配
[performance · medium] **性能问题**: `useFrame` 回调在每帧渲染时都会通过 `new THREE.Vector3()` 分配临时对象。在 60fps
渲染循环下，每秒产生 60 个短生命周期对象，增加 GC 压力，可能导致帧率波动（尤其在移动设备上）。

建议将临时 `Vector3` 提升为模块级变量或 `useRef` 复用，避免每帧分配：

+   const dirRef = useRef(new THREE.Vector3());
+ 
    useFrame(({ camera }) => {
      // 箭头始终悬浮在相机前方 2 单位处
-     const dir = new THREE.Vector3();
+     const dir = dirRef.current;
      camera.getWorldDirection(dir);


─── packages/core/src/tour-player.ts:123-126 ───
> ✅ 已修复 (2026-09-13): preloadScenes 加 `_destroyed` 守卫抛错
[bug · medium] Bug: `preloadScenes` 缺少 `_destroyed` 守卫。同文件中 `switchScene` 方法在检查 `!this.sceneManager`
之后还检查了 `this._destroyed`（第 131 行），但 `preloadScenes` 遗漏了此检查。若 TourPlayer 已销毁但 sceneManager 引用尚未清空，调用
`preloadScenes` 会在已销毁的播放器上触发异步操作，与 `_destroyed` 防护设计意图不一致。

    async preloadScenes(sceneIds: string[]): Promise<void> {
      if (!this.sceneManager) throw new Error('TourPlayer 未加载');
+     if (this._destroyed) throw new Error('TourPlayer 已销毁, 无法预加载场景');
      await this.sceneManager.preloadScenes(sceneIds);
    }


─── packages/core/src/scene-manager.ts:179-183 ───
> ✅ 已修复 (2026-09-13): destroy() 置 `renderer = undefined`
[bug · medium] Bug: `destroy()` 未清除 `renderer` 引用。`TourPlayer.load()` 中通过
`bindRenderer(this.renderer)` 注入了渲染器引用，但 `destroy()` 只清理了 listeners、scenes 和 currentSceneId，未调用
`this.renderer = undefined` 清除引用。销毁后 `this.renderer` 仍持有已销毁渲染器的引用，若存在未完成的异步回调（如 preload 的 catch
路径）访问 `this.renderer`，可能操作已销毁对象。建议在 destroy 中清除 renderer 引用。

    destroy(): void {
      this.listeners.clear();
      this.scenes.clear();
      this.currentSceneId = null;
+     this.renderer = undefined;
    }


─── packages/core/src/scene-manager.ts:104-114 ───
> ✅ 已修复 (2026-09-13): preloadScene 加 `preloading` 标志防重复网络请求
[bug · low] 潜在问题: 当渲染器实现了 `preloadScene` 时，成功路径直接 `return` 但不更新场景状态（仍为 `'unloaded'`）。这意味着重复调用
`preload(id)` 时，开头的 `scene.state === 'loaded'` 守卫不会拦截，导致 `renderer.preloadScene()` 被重复触发，可能产生冗余网络请求。

建议增加一个 `'preloading'` 中间状态或 `preloaded` 标记来防止重复预加载，例如：
```ts
if (scene.state === 'loaded' || scene.state === 'preloading') return;
scene.state = 'preloading'; // 标记正在预加载
```
或者在预加载成功后设置一个 `scene.preloaded = true` 标记并在守卫中检查。



─── apps/demo/src/main.ts:262-264 ───
> ✅ 已修复 (2026-09-13): `webgpuCapability?.adapterInfo` 可选链
[bug · medium] **Bug: 缺少空值保护** — `webgpuCapability` 初始值为 `null`，此处直接访问 `.adapterInfo` 会在
`webgpuCapability` 为 `null` 时抛出 `TypeError`。同文件中 `createHudCallback`（第 615 行）和
`updateBackendPanel`（第 917 行）均已使用可选链 `webgpuCapability?.adapterInfo` 做了保护，此处应保持一致。

虽然 `exportBenchReport()` 通常在渲染器初始化完成后才会被调用，但通过 `window.__bench` 暴露的测试接口可能在异常流程下触发此路径。

-     const gpuInfo = webgpuCapability.adapterInfo
+     const gpuInfo = webgpuCapability?.adapterInfo
        ? `${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}` : 'N/A';
      md += `**GPU**: ${gpuInfo}\n`;


─── apps/demo/src/main.ts:968-970 ───
> ✅ 已修复 (2026-09-13): `__getDeviceInfo` 中 `webgpuCapability?.adapterInfo` 可选链
[bug · medium] **Bug: 同上，缺少空值保护** — `window.__getDeviceInfo` 中直接访问 `webgpuCapability.adapterInfo`，与
`exportBenchReport` 存在相同问题。应使用可选链 `webgpuCapability?.adapterInfo`。

-     const gpuInfo = webgpuCapability.adapterInfo
+     const gpuInfo = webgpuCapability?.adapterInfo
        ? `${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}` : 'N/A';
      return {


─── apps/demo/src/main.ts:287-287 ───
> ✅ 已修复 (2026-09-13): 移除 `__getDeviceInfo` 内重复 tierNames, 复用外层声明
[maintainability · low] **Dead Code: 重复声明** — `tierNames` 在外层作用域（第 287 行）已声明为 `const tierNames =
['LOW', 'MEDIUM', 'HIGH', 'ULTRA']`，此处 `__getDeviceInfo` 内部又重新声明了一份完全相同的数组。应直接引用外层变量，删除此行。



─── apps/demo/src/main.ts:903-905 ───
> ✅ 已修复 (2026-09-13): WebGL2 回退失败置 `renderer = null` + errorEl 提示
[bug · medium] **Bug: 后端切换全部失败后 `renderer` 指向已销毁对象** — 在 try 块中 `renderer.destroy()` 已销毁旧渲染器（第 837
行），如果新渲染器创建失败且 WebGL2 回退也失败（仅 `console.error`），`renderer` 变量仍指向已销毁的旧渲染器。后续任何对 `renderer` 的操作（如 HUD
回调中的属性访问、`window.__renderer` 的外部调用）都将操作已销毁对象，可能导致不可预期的行为。

建议在回退失败的 catch 中将 `renderer` 置为 `null` 并显示用户可见的错误提示，或者尝试重建一个最基本的 WebGL2 渲染器恢复页面可用状态。



─── apps/demo/src/main.ts:24-26 ───
> ✅ 已修复 (2026-09-13): 新建 apps/demo/tsconfig.json 引入类型检查 (宽松档, 增量类型化基础)
[maintainability · medium] **Maintainability: 文件命名为 `.ts` 但完全未使用 TypeScript 类型标注** —
所有变量（`renderer`、`webgpuCapability`、`bench`、`sceneData` 等）均为隐式 `any`，所有函数参数和返回值均无类型声明。且 `apps/demo/`
目录下没有 `tsconfig.json`，意味着连 `tsc --noEmit` 类型检查也不会执行。

既然从内联脚本提取为独立文件是为了更好的开发体验，建议至少：
1. 为 `apps/demo` 添加 `tsconfig.json`（extends 根 `tsconfig.base.json`）
2. 为关键变量和函数签名添加基本类型标注，使 `.ts` 扩展名名副其实



─── packages/renderer-three/src/spz-decoder-worker.ts:286-288 ───
> ✅ 已修复 (2026-09-13): 解压后一次性长度校验 (expectedSize = shOffset + numSplats*shDim*3, 不足抛错)
[bug · high] **[Bug/Security] 缺少解压数据长度校验 — 损坏/截断 SPZ 文件将静默产生 NaN**

`decodeSpzToSplatData` 根据 header 中的 `numSplats` 和 `shDegree` 计算各属性流偏移后，直接在内循环中读取 `decompressed[base
+ j]`，但未校验 `decompressed.byteLength` 是否足以覆盖所有属性流（尤其是 SH 数据区）。

`validateSpzHeader` 仅检查 magic/version/numSplats 上限，不校验解压体实际长度。若 SPZ 文件被截断或损坏，`decompressed[offset]`
将返回 `undefined`，`(undefined - 128) / 128 = NaN`，NaN 会传播到渲染管线的 position/scale/color/rotation/SH
各字段，导致难以排查的渲染异常。

建议在循环前添加一次性长度校验：

    const shOffset = rotationsOffset + rotationsSize;
+   const shSize = shDim > 0 ? numSplats * shDim * 3 : 0;
+   const expectedSize = shOffset + shSize;
+   if (decompressed.byteLength < expectedSize) {
+     throw new Error(
+       `SPZ 数据不完整: 需要 ${expectedSize} 字节, 实际 ${decompressed.byteLength} 字节`,
+     );
+   }
  
    // 分配 SoA 输出


─── packages/renderer-three/src/sog-streamer.ts:266-282 ───
> ✅ 已修复 (2026-09-13): loadShOverlay 优先复用 metadata.shOverlayOffset/Size, 未缓存才兜底尾部 12B Range; 兜底路径加 shDegree 校验
[bug · medium] **[Performance/Bug] `loadShOverlay` 重复发起 Range 请求且遗漏 shDegree 校验**

两个问题：

1. **冗余 HTTP 请求**: `start()` 中已调用 `attachShOverlayMetadata()` 获取文件尾 12B 并将
`shOverlayOffset`/`shOverlaySize` 缓存到 `this.metadata`。但 `loadShOverlay` 未复用这些已缓存字段，而是重新 fetch 同一 12B
尾部。在移动端弱网环境下浪费一次 HTTP 往返。

2. **遗漏 shDegree 校验**: `attachShOverlayMetadata` 在 byte 8 处校验了 `headView.getUint8(8) ===
meta.shDegree`，但 `loadShOverlay` 重新解析尾部时完全跳过了这个校验（第 280-281 行只读了 offset 和 size，未读 byte 8 的
shDegree）。如果文件尾部 shDegree 与 header 中声明的不一致（文件损坏），`loadShOverlay` 会尝试加载错误大小的 overlay 数据。

建议复用已缓存的元数据：

    async loadShOverlay(): Promise<Float32Array | undefined> {
      if (!this.metadata || this.metadata.version < 3 || !this.options.url) return undefined;
  
-     // 1. 文件尾 12B overlay header (Range 请求尾部, 不依赖文件总大小)
+     // 1. 复用 start() 中 attachShOverlayMetadata 已缓存的偏移/大小
+     let overlayOffset = this.metadata.shOverlayOffset;
+     let overlaySize = this.metadata.shOverlaySize;
+ 
+     if (overlayOffset === undefined || overlaySize === undefined || overlaySize === 0) {
+       // 缓存未命中 (attachShOverlayMetadata 失败或 shDegree 不匹配), 重新获取
      const tailSize = 12;
      const headRes = await fetch(this.options.url, {
        headers: { Range: `bytes=-${tailSize}` },
        signal: this._abortController?.signal,
      });
      if (!headRes.ok && headRes.status !== 206) return undefined;
      const headBuf = new Uint8Array(await headRes.arrayBuffer());
      if (headBuf.length < tailSize) return undefined;
  
      const headView = new DataView(headBuf.buffer, headBuf.byteOffset, headBuf.byteLength);
-     const overlayOffset = headView.getUint32(0, true);
-     const overlaySize = headView.getUint32(4, true);
+       overlayOffset = headView.getUint32(0, true);
+       overlaySize = headView.getUint32(4, true);
      if (overlaySize === 0) return undefined;
+       // ★ 校验尾部 shDegree 与 header 声明一致
+       if (headView.getUint8(8) !== this.metadata.shDegree) return undefined;
+     }


─── packages/renderer-three/src/sog-streamer.ts:286-287 ───
> ✅ 已修复 (2026-09-13): overlaySize 不匹配与数据区长度不符两处加 console.warn
[maintainability · low] **[Maintainability] 多处校验失败静默返回 undefined，建议至少添加 `console.warn`**

`loadShOverlay` 中有 7 处 `return undefined` 分别对应不同的失败原因（网络错误、数据过短、overlaySize=0、shDim=0、size
不匹配、数据区读取失败、数据长度不匹配），但全部静默返回。当 SOG v3 文件存在格式不一致时，调用方无法区分"文件无 overlay"（正常情况）与"overlay
数据损坏"（异常情况），增加排查难度。

建议至少在 `overlaySize !== expected` 和 `dataBuf.length !== overlaySize` 这两个数据完整性校验失败处添加
`console.warn`，帮助区分"无 overlay"和"overlay 损坏"。



─── packages/renderer-three/src/splat-grid-culler.ts:124-130 ───
> ✅ 已修复 (2026-09-13): 内联 cellIndexFor, 两趟循环读 positions (一次带 maxCell 钳制)
[performance · low] **[Performance] `buildGrid` 中每个 splat 的 position 被重复读取 5 次**

`cellIndexFor` 在第一遍（计数）和第二遍（填充）各调用一次，每次读取 3 个分量；第二遍 bbox 跟踪又读取 3 个分量。总计每个 splat 读取 5×3 = 15 次
position 分量。对于百万级 splat 场景，可将 `cellIndexFor` 内联到循环体中，用局部变量缓存 x/y/z 一次性完成 cell 索引计算和 bbox 更新。

      for (let i = 0; i < count; i++) {
-       const cellIndex = this.cellIndexFor(i, min, cellSize);
-       this.cells[cellIndex].members[cellCursor[cellIndex]++] = i;
+       const i3 = i * 3;
+       const x = positions[i3];
+       const y = positions[i3 + 1];
+       const z = positions[i3 + 2];
  
-       const x = positions[i * 3];
-       const y = positions[i * 3 + 1];
-       const z = positions[i * 3 + 2];
+       // 内联 cellIndexFor — 避免重复读取 positions
+       const gx = Math.min(this.resolution - 1, Math.floor((x - min.x) / cellSize.x));
+       const gy = Math.min(this.resolution - 1, Math.floor((y - min.y) / cellSize.y));
+       const gz = Math.min(this.resolution - 1, Math.floor((z - min.z) / cellSize.z));
+       const cellIndex = (gx * this.resolution + gy) * this.resolution + gz;
+ 
+       this.cells[cellIndex].members[cellCursor[cellIndex]++] = i;


─── packages/convert/src/cli.ts:379-399 ───
> ✅ 已修复 (2026-09-13): decodeSogToCloud 支持 29B 紧凑布局 + 24B chunk bbox 反量化 + 32B 标准布局, shMode=1 SH DC 在 chunk 末尾跳过
[bug · critical] **[Bug/Critical]** `decodeSogToCloud` 固定按 `SPLAT_BYTES_PER_SPLAT`（32 字节）读取每个
splat，但 SOG chunk 内部布局取决于 `meta.positionQuantization` 和 `meta.shMode`：

- `positionQuantization === SOG_POSITION_QUANT_24BIT` 时，每个 splat 为 **29 字节**（紧凑格式：3×Uint24 位置 +
3×Float32 缩放 + 4×Uint8 颜色 + 4×Uint8 旋转）
- `shMode === SOG_SH_MODE_DC_INT8` 时，每个 splat 额外 **+3 字节**

因此实际 bytes/splat 可能是 29/32/32/35 四种情况。当 SOG 使用了紧凑编码（这是默认行为，`writeSogSoA` 中 `positionQuantization`
默认为 `SOG_POSITION_QUANT_24BIT`），此函数会以 32 字节步长读取 29 字节数据，从第二个 splat 开始所有字段全部错位，产生静默的数据损坏。

建议：根据 `meta.positionQuantization` 和 `meta.shMode` 计算实际
bytesPerSplat，并分别实现紧凑格式（29B）和标准格式（32B）的解码分支。紧凑格式的位置需要从 Uint24 量化值 + chunk bbox 反量化还原。



─── packages/convert/src/spz-reader.ts:471-481 ───
> ℹ️ 误报 — 已核验回退 (2026-09-13): 降序解码与 smallest-three 打包对称, 数值验证误差 ~0.02 为正常量化噪声; 升序实测错位。维持原实现
[bug · high] **[Bug/High]** 四元数解码循环方向与编码顺序不对称。

注释明确说明编码器按 "i 升序跳过 iLargest" 将 3 个分量从低位到高位打包（bits[0..9] = 第一个非最大分量, bits[10..19] = 第二个, bits[20..29]
= 第三个）。但解码循环 `for (let i = 3; i >= 0; i--)` 从高位向低位遍历，将 bits[0..9]（应为 i=0 的数据）赋给了 `out[3]`，导致分量错位。

以 `iLargest=1` 为例：
- 编码器写入顺序：bits[0..9]=comp0, bits[10..19]=comp2, bits[20..29]=comp3
- 解码器降序读取：bits[0..9]→out[3], bits[10..19]→out[2], bits[20..29]→out[0]
- 正确应为：bits[0..9]→out[0], bits[10..19]→out[2], bits[20..29]→out[3]

虽然本仓库的 SPZ writer 只输出 v2（不使用 smallest-three），但此 bug 会影响读取 Niantic 等外部工具生成的 v3+ SPZ 文件，产生可见的旋转伪影。

建议将循环改为升序：`for (let i = 0; i < 4; i++)`。

    // 从低位块开始读取, 顺序与包写 (i 升序跳过 iLargest) 对称
-   for (let i = 3; i >= 0; i--) {
+   for (let i = 0; i < 4; i++) {
      if (i !== iLargest) {
        const mag = c & 0x1ff;
        const negbit = (c >> 9) & 0x1;
        c = c >>> 10;
        const v = ((SQRT1_2 * mag) / 0x1ff) * (negbit ? -1 : 1);
        out[outOffset + i] = v;
        sumSquares += v * v;
      }
    }


─── packages/convert/src/processing.ts:182-198 ───
> ✅ 已修复 (2026-09-13): quickselect/quickselectIndices 改 median-of-three pivot, 防护有序输入 O(N²) 退化
[performance · medium] **[Performance/Medium]** `quickselect` 和 `quickselectIndices` 使用 Lomuto
分区方案（以末尾元素为 pivot），对于已排序、逆序或全相等元素的输入会退化至 O(N²)。在百万级 splat 场景下，若贡献度分数恰好单调分布（如按训练收敛顺序排列），裁剪耗时将从 O(N)
暴增至 O(N²)。

建议：
1. 使用随机 pivot 或 median-of-three 策略替代固定末尾 pivot；
2. 或在调用前对 `scores` 做 Fisher-Yates shuffle 的等价变换（打乱索引数组即可）。



─── packages/convert/src/cli.ts:472-481 ───
> ✅ 已修复 (2026-09-13): convertPly/convertSplat 返回 splat 数, batch 复用返回值, 消除二次 readFile+解析
[performance · medium] **[Performance/Medium]** PLY 和 SPLAT 分支先调用 `convertPly`/`convertSplat`（内部会
`readFile` + 解析），然后又单独 `readFile` + 重新完整解析一遍来仅获取 `splatCount`。对于数百 MB 的 PLY 文件，这意味着双倍的磁盘 I/O 和解析开销。

SPZ/SOG 分支只读取一次，逻辑不一致。建议：
1. 让 `convertPly`/`convertSplat` 返回 splat 数量；或
2. 像 SPZ/SOG 分支一样，先读取 buffer → 解析获取 count → 再调用 `convertCloud`。



─── packages/convert/src/ply-parser.ts:799-804 ───
> ✅ 已修复 (2026-09-13): AoS/SoA 两路径用实际 shRestCount (= shRest.length/count) + Math.min 截断防越界; SoA 补 shBase 定义
[bug · medium] **[Bug/Medium]** `buildCloudSoAFromFastPath` 中 SH 系数拷贝使用 `fastData.shRest[i *
totalShCoeffs + j]`，但 `fastData.shRest` 的实际布局是每顶点 `shRestCount` 个系数（`shRestCount` 来自 PLY header 中
`f_rest_*` 属性的实际数量）。

当 PLY 文件包含非标准数量的 f_rest 属性时（如 12 个而非标准的 9/24/45 个），`shRestCount=12` 但
`totalShCoeffs=9`（shDegree=1），此时 `i * totalShCoeffs` 不等于 `i * shRestCount`，从第二个顶点开始索引就会错位。

注意：AoS 路径的 `buildCloudFromFastPath` 也有同样的问题（`fastData.shRest[i * totalShCoeffs + j]`），但 SoA 新路径不应继承此
bug。

建议将索引改为 `fastData.shRest[i * shRestCount + j]`，其中 `shRestCount = fastData.shRest.length / count`。

      if (sh && hasShRest && fastData.shRest) {
+       const shRestCount = fastData.shRest.length / count;
        const shBase = i * totalShCoeffs;
+       const srcBase = i * shRestCount;
        for (let j = 0; j < totalShCoeffs; j++) {
-         sh[shBase + j] = fastData.shRest[i * totalShCoeffs + j] || 0;
+         sh[shBase + j] = fastData.shRest[srcBase + j] || 0;
        }
      }


─── packages/convert/test-fixtures/benchmark-ply.ts:171-182 ───
> ✅ 已修复 (2026-09-13): 文件末尾补换行 (POSIX)
[style · low] **[Bug/Low]** 文件末尾缺少换行符（diff 显示 `\ No newline at end of file`），不符合 POSIX
文本文件规范。部分工具（diff、concat、某些 linter）可能产生警告。



─── packages/convert/src/cli.ts:145-156 ───
> ✅ 已修复 (2026-09-13): to-compressed-ply 应用 --prune/--contribution-cutoff/--max-splats (移植 convertCloud 预裁剪契约)
[bug · medium] **[Bug/Medium]** `to-compressed-ply` 命令定义了
`--max-splats`、`--prune`、`--min-opacity`、`--contribution-cutoff` 四个选项，但 action handler
中完全没有使用它们。`loadCloudFromAny` 加载数据后直接调用 `writeCompressedPly` 写入，没有任何裁剪/剔除处理。

用户在 CLI 中使用这些选项会被静默忽略，产物不会按预期裁剪。建议：要么在 `loadCloudFromAny` 和 `writeCompressedPly` 之间加入与
`convertCloud` 相同的 prune/maxSplats 处理逻辑，要么移除这些未实现的选项以避免误导。



─── packages/core/schema/tour-config.schema.json:74-77 ───
> ✅ 已修复 (2026-09-13): CameraSettings/SceneTransition/QualitySettings/SceneConfig/initialView/info/overrides 各 definition 加 additionalProperties: false
[maintainability · medium] Schema 一致性问题: 根 schema 设置了 `"additionalProperties": false` (第 7 行)，但
`SceneConfig` 定义未设置。这意味着场景配置中的字段名拼写错误（如 `"sorce"` 代替 `"source"`）在 JSON Schema 校验时不会被捕获——schema
校验器会静默忽略未知字段。虽然运行时 `validateTourConfigJson` 会因缺少 `source` 而报错，但如果用户写了 `"sorce"` 同时保留了正确的
`"source"`，则两个校验都不会报错，拼写错误被静默忽略。

建议在 `SceneConfig` 中也添加 `"additionalProperties": false`，或者如果确实需要保留扩展能力（如 `extensions`
字段），可以显式文档说明允许额外属性的原因。同样，`CameraSettings`、`SceneTransition`、`QualitySettings` 等 definition 也缺少此约束。



─── packages/core/src/tour-config.ts:201-206 ───
> ✅ 已修复 (2026-09-13): initialView 子字段校验 (yaw/pitch 数值, fov 1-179 范围)
[maintainability · low] `validateTourConfigJson` 的 JSDoc 声明 "运行时使用本函数做**完整校验**"，但实际对 `initialView`
仅检查了是否为对象，未校验其子字段（`yaw`/`pitch`/`fov` 的类型及 `fov` 的范围 1-179）。与之配套的 JSON Schema
对这些子字段定义了详细约束，但运行时校验完全未覆盖，导致非法配置（如 `initialView: { fov: "wide" }` 或 `initialView: { fov: 999
}`）能通过运行时校验。

建议至少补充 `initialView` 子字段的类型和范围检查，使运行时校验与 schema 约束保持一致；或者修改文档说明运行时校验仅覆盖核心必填字段，详细约束需依赖 schema 校验。



─── apps/r3f-example/package.json:5-9 ───
> ✅ 已修复 (2026-09-13): 新建 apps/r3f-example/vite.config.ts (COOP/COEP + CORP headers, server+preview)
[bug · medium] **缺少 vite 配置文件**: 该示例应用没有 `vite.config.ts`。对比 `apps/demo/vite.config.js`，demo 应用配置了
COOP/COEP 响应头以启用 `SharedArrayBuffer`（Spark 排序 Worker 依赖此特性）。缺少这些头信息时，`SharedArrayBuffer` 不可用，Spark
排序 Worker 可能无法正常工作或回退到性能较差的路径，导致示例无法正确运行。

建议参照 demo 应用添加 `vite.config.ts`，至少包含 COOP/COEP 头配置：
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { conditions: ['development', 'browser'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```



─── packages/convert/src/sog-writer.ts:498-498 ───
> ✅ 已修复 (2026-09-13): 新增 SOG_SH_MODE_FULL_INT8=2 常量, v3 overlay header 字节 9 写入实际 shMode
[bug · high] **[high] v3 SH overlay header 的 shMode 字节硬编码为 `SOG_SH_MODE_DC_INT8`，但 overlay 实际存储的是完整
SH 系数（degree 1/2/3，每 splat shDim×3 字节），而非仅 DC 三个分量。**

`SOG_SH_MODE_DC_INT8 = 1` 的语义是 "追加 SH DC 3 bytes (Int8 量化)"（见第 110 行），而 v3 overlay 写入的数据量为
`numSplats * shDim * 3` 字节（shDim 可为 3/8/15），远超 DC-only 的 3 bytes/splat。如果读取端依据此字节判断 overlay
数据的布局/反量化方式，会将高阶 SH 数据错误地当作 DC-only 解析。

建议：定义一个新的 overlay 专用模式常量（如 `SOG_SH_MODE_FULL_INT8 = 2`），或直接使用 `soa.shDegree` 对应的完整 SH 模式标识，使读取端能正确区分
DC-only 和 full SH overlay。



─── packages/convert/src/compressed-ply-writer.ts:77-77 ───
> ✅ 已修复 (2026-09-13): source 写入 header comment (SuperSplat 兼容)
[maintainability · medium] **[medium] `source` 选项被 `void options` 静默丢弃，但 CLI 已传入该值。**

CLI (`cli.ts:156`) 调用 `writeCompressedPly(cloud, { source: input })` 传入了源文件路径，但函数体中 `void options`
直接忽略了整个 options 对象。SuperSplat 格式的 PLY 文件通常在 header 中包含 `comment` 行记录来源信息，建议将 `source` 写入 PLY header
的 comment 行（如 `comment source: ${options.source}`），或至少在接口文档中明确标注该字段当前未实现。



─── packages/convert/src/compressed-ply-writer.ts:226-226 ───
> ✅ 已修复 (2026-09-13): cb2 → cb 改名, 消除与外层 chunk 基址混淆
[maintainability · medium] **[medium] 变量名 `cb2`（量化后蓝色通道值）与外层作用域的 `cb`（chunk 数据区基址偏移，第 172 行）高度相似。**

在嵌套循环中两个变量同时可见，`cb` 是 `DataView` 写入基址（数值很大），`cb2` 是 0-255 的量化颜色值，语义完全不同但名称极易混淆。建议重命名为 `blueQ` 或 `qb`
以提高可读性并降低后续维护出错风险。

-       const cb2 = quantize8(soa.colors[i3 + 2], minB, maxB);
+       const blueQ = quantize8(soa.colors[i3 + 2], minB, maxB);


─── packages/convert/src/compressed-ply-writer.ts:173-176 ───
> ✅ 已修复 (2026-09-13): set() 加 indexOf === -1 防护
[maintainability · medium] **[medium] `set()` 辅助函数使用 `indexOf` 查找属性索引，若传入不在 `SS_CHUNK_PROPS`
中的名称，`indexOf` 返回 -1，将导致 `view.setFloat32(cb - 4, value, true)` 静默写入 chunk 数据之前的内存区域，破坏相邻 chunk
或顶点数据而不报错。**

虽然当前所有 18 次调用使用的都是硬编码的正确名称，但这种模式缺乏防御性。建议改为直接使用字面量索引偏移（如 `view.setFloat32(cb + 0, minX, true)`
等），或至少添加 `if (idx < 0) throw` 断言。直接写偏移量还能消除每 chunk 18 次 `indexOf` 的 O(n) 开销。



─── packages/convert/src/sog-writer.ts:608-613 ───
> ✅ 已修复 (2026-09-13): parseSogMetadata 加 overlay 偏移下界 (>= SOG_HEADER_SIZE=64) + 上界校验
[security · medium] **[medium] v3 overlay 偏移校验不完整：仅检查了上界 (`shOverlayOffset + shOverlaySize <=
oh`)，未检查下界。**

恶意或损坏的文件可能声明 `shOverlayOffset` 指向文件头部区域（如 byte 0-63 的 header），此时 `shOverlayOffset + shOverlaySize <=
oh` 仍可能为 true，导致读取端将 header 字节误解析为 SH 系数。建议增加 `shOverlayOffset >= SOG_HEADER_SIZE + numChunks * 8`（即
`dataOffset` 的最小值）的下界校验，或者至少确保 `shOverlayOffset` 不小于 header + chunk index 的大小。



─── packages/renderer-three/src/webgl-render-manager.ts:555-556 ───
> ✅ 已修复 (2026-09-13): settled = true 移入 finally, onLoad 加 settled/_destroyed 守卫 (Critical)
[bug · critical] Bug: 当 `_withTimeout` 因超时 reject 时，`await` 抛出异常直接跳转到 `finally` 块，`settled = true`（第
556 行）永远不会执行。这意味着超时后迟到的 `onLoad` 回调仍会看到 `settled === false`，从而将 SplatMesh 添加到场景并设置
`this.currentSplat`，导致：
1. 场景中出现孤立 mesh（调用方已认为加载失败）
2. 后续 `loadScene` 调用清理时无法找到这个 mesh（`this.currentSplat` 已被覆盖）

建议将 `settled = true` 放入 `finally` 块，确保超时和成功路径都标记已结算。

-       // 标记已结算, 后续迟到的 onLoad 一律忽略 (含超时后异常路径)
-       settled = true;
+       // settled 在 finally 中标记 (原位置在超时路径不可达)


─── packages/renderer-three/src/webgl-render-manager.ts:666-671 ───
> ✅ 已修复 (2026-09-13): createSplatMeshFromBytes 加 settled 守卫 + finally (High)
[bug · high] Bug: `createSplatMeshFromBytes` 和 `loadSceneWithSpz` 中使用 `setTimeout` 拒绝 Promise，但没有
`settled` 标志保护。当 30s 超时触发 `reject` 后，若 `onLoad` 回调迟到的触发，仍会执行 `this.scene!.add(loadedMesh)` 和
`this.currentSplat = loadedMesh`，在调用方已认为加载失败的情况下向场景添加了孤立 mesh。

建议：与 `loadScene` 的 URL 直加载路径一致，添加 `settled` 标志，在 `onLoad` 回调中检查，超时后丢弃迟到的 mesh。



─── packages/renderer-three/src/webgl-render-manager.ts:299-303 ───
> ✅ 已修复 (2026-09-13): context lost 处理器显式 cancelAnimationFrame + rafId=0 (High)
[bug · high] Bug: WebGL context restored 处理器中，`_startRenderLoop()` 在 `loadScene()` 之后同步调用。但 context
lost 时仅设置 `_running = false`，未取消 RAF（`rafId` 仍非零）。旧 RAF 回调尚未执行（`_running` 为 false 但 `rafId !==
0`），此时 `_startRenderLoop()` 因 `if (this.rafId !== 0) return` 直接返回，不会启动新循环。当旧 RAF 最终执行时，检测到 `_running
=== false` 后退出并将 `rafId` 置零，但不会再有新的循环被启动。

建议在 context lost 处理器中取消 RAF：
```typescript
this._contextLostHandler = (e: Event) => {
  e.preventDefault();
  cancelAnimationFrame(this.rafId);
  this.rafId = 0;
  this._running = false;
};
```

      this._contextLostHandler = (e: Event) => {
        e.preventDefault();
        console.warn('[RenderManager] WebGL context lost — GPU 资源已释放, 等待 restore...');
+       cancelAnimationFrame(this.rafId);
+       this.rafId = 0;
        this._running = false;
      };


─── packages/renderer-three/src/webgl-render-manager.ts:818-826 ───
> ✅ 已修复 (2026-09-13): SOG 临时 mesh onLoad 加 `_destroyed || currentSplat !== loadedMesh` 守卫 (High)
[bug · high] Bug: SOG 流式加载中，chunk 0 到达时异步创建临时 SplatMesh（`onChunkLoaded` 回调），但其 `onLoad` 回调可能在
`loadSogChunks` 返回后才触发。此时：
1. 第 837 行的清理代码 `if (this.currentSplat)` 检查时，临时 mesh 尚未被设置到 `this.currentSplat`，不会被清理
2. 临时 mesh 的 `onLoad` 后续触发后，会将自身添加到场景并覆盖 `this.currentSplat`（此时已指向完整 mesh）
3. 临时 mesh 成为孤立 mesh，永远无法被清理

建议：在临时 mesh 的 `onLoad` 中检查是否已被完整 mesh 替代（例如通过比较引用或增加标志位），若已被替代则 `dispose()` 并跳过。

                onLoad: async (loadedMesh: SplatMesh) => {
+                 // 若完整 mesh 已就绪 (loadSogChunks 已返回并设置了 currentSplat),
+                 // 丢弃临时 mesh 避免泄漏
+                 if (this.currentSplat && this.currentSplat !== loadedMesh) {
+                   loadedMesh.dispose();
+                   return;
+                 }
                  if (this._autoOrient) {
                    loadedMesh.rotation.x = Math.PI;
                  }
                  this.scene!.add(loadedMesh);
                  this.currentSplat = loadedMesh;
                  this.positionCameraToBounds(loadedMesh);
                  this.applyInjectionsToMaterial();
                },


─── packages/renderer-three/src/wgsl/splat-render-shader.ts:255-257 ───
> ✅ 已修复 (2026-09-13): SH DC 去重复乘 SH_C0 — outR = dcR + Σ (colors 流已含 SH_C0*f_dc+0.5) (High)
[bug · high] Bug: SH 球谐求值中 DC 分量处理错误。数据管线中 `colors` 存储的已经是最终 0-1 颜色值（`SH_C0 * f_dc + 0.5`），而非原始 f_dc
系数：
- PLY 加载：`colorR = SH_C0 * f_dc_0 + 0.5`（gaussian-loader.ts:236）
- SPZ 编码：`scaleRgbToSpz(colorR)` 编码的是上述最终颜色
- SPZ 解码：`decodeSpzToSplatData` 恢复的也是最终颜色

因此 shader 中 `outR = SH_C0 * dcR + ...` 将 DC 颜色值再次乘以 SH_C0（≈0.282），导致基础颜色被严重压暗（如 0.5 → 0.14）。

正确公式：`outR = dcR + Σ coeff_k * basis_k(viewDir)`，DC 直接使用，无需 SH_C0 缩放。

-     outR = SH_C0 * dcR + shCoeffs[base] * l1y + shCoeffs[base + 3u] * l1z + shCoeffs[base + 6u] * l1x;
-     outG = SH_C0 * dcG + shCoeffs[base + 1u] * l1y + shCoeffs[base + 4u] * l1z + shCoeffs[base + 7u] * l1x;
-     outB = SH_C0 * dcB + shCoeffs[base + 2u] * l1y + shCoeffs[base + 5u] * l1z + shCoeffs[base + 8u] * l1x;
+     outR = dcR + shCoeffs[base] * l1y + shCoeffs[base + 3u] * l1z + shCoeffs[base + 6u] * l1x;
+     outG = dcG + shCoeffs[base + 1u] * l1y + shCoeffs[base + 4u] * l1z + shCoeffs[base + 7u] * l1x;
+     outB = dcB + shCoeffs[base + 2u] * l1y + shCoeffs[base + 5u] * l1z + shCoeffs[base + 8u] * l1x;


─── packages/renderer-three/src/webgl-render-manager.ts:881-883 ───
> ✅ 已修复 (2026-09-13): SOG 完整 mesh 加 settled 守卫 (Promise.finally 置 settled)
[bug · medium] Bug: 与 `loadScene` 的 URL 直加载路径相同的问题 — SOG 完整 mesh 创建使用 `setTimeout` 做超时保护，但 `onLoad`
回调中没有 `settled` 标志保护。超时 reject 后，迟到的 `onLoad` 仍会将 mesh 添加到场景。

建议添加与 URL 直加载路径一致的 `settled` 标志保护。



─── packages/renderer-three/src/webgl-render-manager.ts:151-151 ───
> ✅ 已修复 (2026-09-13): preloadScene 加 MAX_PRELOAD_ENTRIES=16 LRU 淘汰 (webgl+webgpu)
[maintainability · medium] `_preloadCache` 使用 `Map<string, Uint8Array>`
存储预取数据，无大小限制和淘汰策略。多次预取大场景文件（数百 MB 的 .splat/.spz）可能导致内存持续增长，仅在 `destroy()` 时清理。建议添加 LRU
淘汰策略或总容量上限，或者至少在 `loadScene` 时清理非当前场景的缓存条目。



─── packages/renderer-three/src/webgpu-render-manager.ts:1212-1219 ───
> ✅ 已修复 (2026-09-13): mask 变更检测对齐时用 Uint32Array 视图批量比较 + 尾部余数逐字节
[performance · medium] 性能: mask 变更检测通过逐元素比较 `Uint8Array`，对于百万级 splat 场景，最坏情况下（mask 未变化）需要遍历全部元素（1M+
次比较），可能产生明显的 CPU 开销（每 3 帧执行一次）。

可考虑使用 `Uint32Array` 视图进行 4 字节对齐比较（减少 4x 迭代），或使用分块哈希（每 256 字节一个 hash 值）加速比较。



─── packages/renderer-three/src/webgl-render-manager.ts:750-750 ───
> ✅ 已修复 (2026-09-13): SPZ 原生路径加 settled 守卫 (Promise.finally 置 settled + onLoad 守卫)
[bug · medium] Bug: 与 `createSplatMeshFromBytes` 相同的问题 — SPZ 原生加载路径的 `setTimeout` 超时后，迟到的 `onLoad`
回调仍会将 mesh 添加到场景。需要 `settled` 标志保护。



─── packages/renderer-three/src/webgl-render-manager.ts:907-909 ───
> ✅ 已修复 (2026-09-13): getDeviceTier() 返回 this._deviceTier (尊重 options 覆盖)
[bug · low] `getDeviceTier()` 返回 `this.deviceProfile.tier`（自动检测的原始分级），而非 `this._deviceTier`（可能被
`options.deviceTier` 覆盖后的实际分级）。当用户通过构造函数传入 `deviceTier` 覆盖时，此方法返回的值与实际使用的分级不一致。

    getDeviceTier(): DeviceTier {
-     return this.deviceProfile.tier;
+     return this._deviceTier;
    }


─── packages/renderer-three/src/webgpu-render-manager.ts:265-265 ───
> ✅ 已修复 (2026-09-13): webgpu preloadScene 加 MAX_PRELOAD_ENTRIES=16 LRU 淘汰
[maintainability · medium] 与 WebGL 端相同的问题：`_preloadCache` 无大小限制和淘汰策略，仅在 `destroy()`
时清理。多次预取大场景文件可能导致内存持续增长。



─── packages/convert/src/spz-reader.ts:84-87 ───
> ✅ 已修复 (2026-09-13): JSDoc 引用改为 parseLegacyHeader (不存在函数名修正)
[documentation · low] **[Documentation/Low]** JSDoc 引用了不存在的函数
`parseSpzHeaderDecompressed`。代码库中没有任何同名导出或函数定义，调用方按文档指引会找不到目标。应改为指向实际存在的
`parseLegacyHeader`（接受已解压字节）。

另外 `@returns` 行有一个多余的右括号：`(v4 需要解压器))` → `(v4 需要解压器)`。

-  * 同步解析 gzip 文件的调用方请使用 {@link parseSpzHeaderDecompressed}。
+  * 同步解析 gzip 文件的调用方请先 `gzipDecompress` 再调用 {@link parseLegacyHeader}。
   *
   * @param data SPZ 文件字节
-  * @returns 头信息 (v4 需要解压器))
+  * @returns 头信息 (v4 需要解压器)


─── packages/convert/src/spz-writer.ts:187-188 ───
> ✅ 已修复 (2026-09-13): shDim*3 提取为 shPerSplat 常量, 循环内不再重复计算
[maintainability · low] **[low] `soa.sh` 在内部循环中被重复求值，但它的值在循环过程中不会改变。**

第 187 行的 `soa.sh ? soa.sh[shBase + j] : 0` 和第 188 行的 `soa.sh ? quantizeSh(v, bits) : 128` 每次迭代都对同一个
`soa.sh` 做 truthy 检查。由于 `soa.sh` 在内循环中不会变化，建议将分支提到内循环外层，消除冗余判断并提升可读性：

```ts
if (shDim > 0) {
  if (soa.sh) {
    for (let i = 0; i < numSplats; i++) {
      const base = offset + i * shDim * 3;
      const shBase = i * shDim * 3;
      for (let j = 0; j < shDim * 3; j++) {
        const bits = j < 9 ? 5 : 4;
        view.setUint8(base + j, quantizeSh(soa.sh[shBase + j], bits));
      }
    }
  } else {
    for (let i = 0; i < numSplats; i++) {
      const base = offset + i * shDim * 3;
      for (let j = 0; j < shDim * 3; j++) {
        view.setUint8(base + j, 128);
      }
    }
  }
}
```

这样每个分支内的逻辑更加清晰，也避免了每迭代一次就做两次重复的 truthy 判断。

-         const v = soa.sh ? soa.sh[shBase + j] : 0;
-         view.setUint8(base + j, soa.sh ? quantizeSh(v, bits) : 128);
+         // hoist soa.sh branch outside the inner loop — see suggested refactor above


─── packages/renderer-three/src/webgl-render-manager.ts:1262-1273 ───
> ✅ 已修复 (2026-09-13): setupDprListener onChange 后 teardown + 重建 matchMedia 查询跟踪新 DPR
[bug · medium] Bug: `matchMedia('(resolution: Xdppx)')` 创建的是对**当前** DPR 的精确匹配查询。当 DPR 首次变化（例如从 2x →
1x）时，`onChange` 触发并正确更新参数。但此后该 media query 已不再匹配（当前 DPR 已不是 2x），**后续**的 DPR 变化（如 1x → 1.5x →
3x）不会再触发 `change` 事件，因为查询条件始终是旧的 `2dppx`。

建议在 `onChange` 处理器中重新注册监听器以跟踪新的 DPR 值：
```typescript
const onChange = (): void => {
  // 先注销旧查询
  this.teardownDprListener();
  // 更新参数
  const next = getTierSettings(this._deviceTier);
  this.tierSettings = next;
  this._pixelRatio = next.pixelRatio;
  this.renderer?.setPixelRatio(next.pixelRatio);
  this.updateRenderSize();
  // 重新注册以监听新的 DPR
  this.setupDprListener();
};
```



─── packages/renderer-three/src/webgl-render-manager.ts:818-826 ───
> ✅ 已修复 (2026-09-13): onChunkLoaded 临时 mesh onLoad 加 `_destroyed` 守卫, destroy 后迟到的 mesh 被 dispose 丢弃
[bug · medium] Bug: `onChunkLoaded` 中异步创建的临时 SplatMesh 的 `onLoad` 回调未检查 `this._destroyed`。如果
RenderManager 在 SOG 加载过程中被 `destroy()`，`_sogStreamer.abort()` 被调用但 chunk 0 可能已到达且 SplatMesh
正在异步构建。`onLoad` 在 destroy 之后触发时，会将 mesh 添加到已销毁的场景中，创建无法被清理的孤立 mesh（`destroy()` 已经执行，不会再清理新添加的 mesh）。

建议在 `onLoad` 回调开头添加销毁检查：
```typescript
onLoad: async (loadedMesh: SplatMesh) => {
  if (this._destroyed) {
    loadedMesh.dispose();
    return;
  }
  // ...existing code...
}
```



─── packages/renderer-three/src/spz-decoder-worker.ts:330-337 ───
> ℹ️ 部分修复 — 布局约定已在注释澄清 (2026-09-13): 管线整体系数为 coefficient-major 一致 (PLY→SPZ→shader 同约定), 渲染正确; Niantic channel-major 外部文件重排未实现, 已在注释记录
[bug · medium] Bug: SH 数据布局注释与 shader
索引约定不一致。注释声明输出为「channel-major」（R0,R1,R2,...,G0,G1,G2,...,B0,B1,B2,...），但 `splat-render-shader.ts` 中的
SH 求值代码按 coefficient-major 索引（`shCoeffs[base] * l1y + shCoeffs[base + 3u] * l1z + shCoeffs[base +
6u] * l1x`，即 R0,G0,B0,R1,G1,B1,...）。

对于本项目 convert 管线生成的 SPZ 文件（PLY 输入为 coefficient-major，writer 透传），round-trip 结果正确。但对于遵循 Niantic SPZ
参考实现（channel-major 原生约定）的外部 SPZ 文件，WebGPU 渲染器会产生错误的视角依赖着色。

建议：在 decoder 中将 SPZ 的 channel-major 字节重排为 coefficient-major 输出（与 shader 索引一致），或修正注释并统一全管线约定。



LLM retry report summary: 19 of 265 requests affected -- 3 requests failed, 16 requests recovered after retry

Review planning (2 requests):
- packages/convert/src/compressed-ply-writer.ts,packages/convert/src/sog-writer.ts,packages/convert/src/splat-writer.ts,packages/convert/src/spz-writer.ts: provider error (HTTP 524) -> provider error (HTTP 524) -> succeeded
- packages/renderer-three/src/webgl-render-manager.ts,packages/renderer-three/src/webgpu-render-manager.ts,packages/renderer-three/src/wgsl/splat-render-shader.ts: provider error (HTTP 524) -> provider error (HTTP 524) -> succeeded

Core review (15 requests):
- apps/demo/index.html,apps/demo/src/main.ts: rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> failed
- benchmarks/benchmark.ts: rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> failed
- packages/renderer-three/package.json,packages/renderer-three/src/index.ts,packages/renderer-three/src/shared/fetch-util.ts,packages/renderer-three/src/shared/scene-loader.ts,packages/renderer-three/src/shared/stats.ts,packages/renderer-three/src/shared/types.ts,packages/renderer-three/src/sog-streamer.ts,packages/renderer-three/src/splat-grid-culler.ts,packages/renderer-three/src/spz-decoder-worker.ts: provider error (HTTP 530) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> failed
- .github/workflows/ci.yml,package.json,pnpm-lock.yaml,vitest.config.ts: provider error (HTTP 530) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> succeeded
- apps/demo/index.html,apps/demo/src/main.ts: provider error (HTTP 502) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> rate limited (HTTP 429) -> succeeded
- ... and 10 more

Comment filtering (2 requests):
- .github/workflows/ci.yml,package.json,pnpm-lock.yaml,vitest.config.ts: provider error (HTTP 502) -> succeeded
- packages/core/package.json,packages/core/schema/tour-config.schema.json,packages/core/src/renderer-adapter.ts,packages/core/src/scene-manager.ts,packages/core/src/tour-config.ts,packages/core/src/tour-player.ts: provider error (HTTP 502) -> rate limited (HTTP 429) -> succeeded

Per-attempt detail: --format json (retry_report).
