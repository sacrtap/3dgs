# @3dgs/convert

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
