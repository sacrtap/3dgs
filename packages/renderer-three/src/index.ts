/**
 * @3dgs/renderer-three — 渲染器入口
 *
 * ★ TD-04: index.ts 拆分 — WebGL RenderManager 移至 webgl-render-manager.ts,
 *   本文件仅保留: 公共导出 + 渲染器工厂 + 类型。
 *   (原 1500+ 行决策密集文件拆分后, 各职责单一可维护)
 */

// ─── WebGL 后端 (生产) ──────────────────────────────────────
export { RenderManager, ThreeRenderer, type RenderManagerOptions } from './webgl-render-manager.js';

// ─── WebGPU 检测 + 渲染器工厂 ──────────────────────────────
export { detectWebGPU, isWebGPUMaybeAvailable } from './webgpu-detector.js';
export type {
  WebGPUCapability,
  GpuType,
  WebGPULimits,
  TextureCompressionSupport,
} from './webgpu-detector.js';

export { createRenderer, createRendererSync } from './renderer-factory.js';
export type {
  RendererBackend,
  CreateRendererOptions,
  CreateRendererResult,
} from './renderer-factory.js';

// ─── SOG 流式 LOD ──────────────────────────────────────────
export { SogStreamer } from './sog-streamer.js';
export type { SogStreamerOptions, SogMetadata, SogChunkEntry } from './sog-streamer.js';

// ─── SPZ 解码 ───────────────────────────────────────────────
// ★ TD-01: decodeSpzToSplatData — SPZ → SoA 直接解码 (保留 SH, WebGPU 加载路径使用)
//   decodeSpzInWorker/decodeSpz — .splat 中间格式解码 (公共 API, 保留供消费者使用)
export {
  decodeSpzInWorker,
  decodeSpz,
  parseSpzHeader,
  readSpzHeader,
  validateSpzHeader,
  SPZ_MAGIC,
  SPZ_VERSION,
  decodeSpzToSplatData,
} from './spz-decoder-worker.js';
export type { SpzHeader } from './spz-decoder-worker.js';

// ─── P2-1: 视锥剔除预处理 ─────────────────────────────────
export { SpatialGrid, FrustumCulling } from './frustum-culling.js';
export type { SpatialCell, VisibleRange } from './frustum-culling.js';

// ─── P2-2: Buffer 池化复用 ────────────────────────────────
export { SplatBufferPool } from './buffer-pool.js';
export type { BufferPoolStats, BufferPoolOptions } from './buffer-pool.js';

// ─── ★ TD-08/05: 双后端共享加载/数据工具 ─────────────────
export { fetchWithProgress } from './shared/fetch-util.js';
export { downsampleSplatBytes, downsampleSplatData, loadSogChunks } from './shared/scene-loader.js';
export type {
  DownsamplePool,
  DownsampleResult,
  SogChunkHandlers,
  LoadSogChunksResult,
} from './shared/scene-loader.js';
export type { SplatData } from './shared/types.js';

// ─── ★ TD-09: 空间分块视锥裁剪 ───────────────────────────
export { SplatGridCuller, DEFAULT_GRID_RESOLUTION } from './splat-grid-culler.js';
export type { SplatGridCell } from './splat-grid-culler.js';

// ─── P3-1: WebGPU 渲染后端 ────────────────────────────────
export { WebGPURenderManager } from './webgpu-render-manager.js';
export type { WebGPURenderManagerOptions } from './webgpu-render-manager.js';

// ─── P3-2: WebGPU Compute Shader 排序 ─────────────────────
export { WebGPUSortManager } from './webgpu-sort-manager.js';
export type { WebGPUSortManagerOptions, SortResult } from './webgpu-sort-manager.js';
