# @3dgs/convert

## 0.4.0

### Minor Changes

- e73ab1b: 核心链路重构与预加载支持

  **core**
  - 预加载端到端支持: `SceneInstance` 新增 `preloading` 字段, 消除预加载类型断言
  - 统计事件与 JSON Schema 校验落地

  **convert**
  - SoA (结构体数组) 全链路转换管线
  - SPZ v1-v4 读取、SOG v3 写入、压缩 PLY 支持
  - 完整 round-trip 测试套件

  **renderer-three**
  - WebGL/WebGPU 双后端共享模块抽取 (fetch/降采样/SOG 加载)
  - SOG v3 流式传输 + WebGPU SH (球谐) 保留
  - SPZ 解码/WebGPU 检测类型重新导出整理 (公共 API 不变)

  **plugins**
  - Shader 注入 presets 扩展 + 触摸手势测试补强

  **react / vue**
  - 预加载与 initialScene 时序行为增强 (接口兼容)

## 0.3.0

### Minor Changes

- 7f59cf4: feat: 新增空间媒体嵌入(图像/视频无缝融合)、热点点击弹出、Shader 预设库; 渲染正确性与性能优化(WebGPU 索引管线/restore 循环/超时保护/隐藏暂停/高分屏与 iPad 识别); convert 新增 SuperSplat 快路径与 Buffer 安全切片; core/react 修复渲染器切换帧回调与双加载。

## 0.2.0

### Minor Changes

- b80219d: ## Native WebGPU Backend and Rendering Performance Optimizations

  ### @3dgs/convert (minor)
  - **SOG v2 format**: Added gzip compression for chunk data, native LOD tree
    metadata (Morton prefix subset), and position quantization (29-byte compact
    splat format, ~9% smaller). Backward compatible with SOG v1.
  - **Morton Code optimization**: Replaced BigInt-based 21-bit per axis
    implementation with a 16-bit Number version using magic bits lookup table
    (50-100x faster, eliminates BigInt overhead).
  - **SPZ writer fix**: Only gzip-compress the body section; keep the 16-byte
    header uncompressed. Previously the entire buffer was compressed, causing
    magic mismatch and decoder failures.
  - **New exports**: `buildLodLevels`, `serializeLodTree`, `deserializeLodTree`,
    and SOG v2 format constants.

  ### @3dgs/core (patch)
  - **LoadOptions**: Added optional `onFirstFrame` callback, fired when the first
    SOG chunk is rendered to screen, enabling early loading mask removal.

  ### @3dgs/renderer-three (minor)
  - **WebGPU native backend (P3-1)**: Implemented `WebGPURenderManager` for
    native WebGPU splat rendering with `WebGPUSortManager` (GPU compute shader
    radix sort), WGSL shader utilities, and SPZ decoder web worker.
  - **Dual-backend switching**: `renderer-factory` now selects
    `WebGPURenderManager` when WebGPU is available, falling back to
    `RenderManager` (WebGL2 + Spark) otherwise.
  - **Enhanced WebGPU detection**: GPU type classification (discrete/integrated/
    mobile/software), texture compression support (BC/ETC2/ASTC), key limits
    reporting, and per-GPU performance recommendations.
  - **Device tier settings**: Added `minSortIntervalMs` (sort throttling),
    foveated rendering parameters (`coneFov0`/`coneFov`/`coneFoveate`/
    `behindFoveate`), `maxPagedSplats`/`numLodFetchers` for GPU memory paging,
    and quality settings (`blurAmount`/`minAlpha`/`focalAdjustment`).
  - **Module refactoring**: Extracted `KeyboardControls`, `FrameCallbackManager`,
    `CameraMatrixCache`, `FrustumCulling`, and `SplatBufferPool` from
    `RenderManager` into standalone, tested modules.
  - **Dependencies**: Added `@webgpu/types` for WebGPU type definitions.
