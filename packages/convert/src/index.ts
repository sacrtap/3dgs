/**
 * @3dgs/convert — 3DGS 数据转换工具包
 *
 * 提供 PLY → SPLAT / SPZ / SOG 格式转换能力
 *
 * 用法 (编程 API):
 *   import { loadGaussiansFromPly, writeSplat, writeSpz, writeSog } from '@3dgs/convert';
 *
 * 用法 (CLI):
 *   npx 3dgs-convert ply-to-splat input.ply --output output.splat
 *   npx 3dgs-convert ply-to-spz input.ply --output output.spz --sh-degree 1
 *   npx 3dgs-convert ply-to-sog input.ply --output output.sog
 *   npx 3dgs-convert batch ./scenes/ --format spz --sh-degree 1
 *   npx 3dgs-convert generate-tour ./scenes/ --output tour.json
 */

// PLY 解析
export { parsePly } from './ply-parser.js';
export type {
  PlyData,
  PlyHeader,
  PlyElement,
  PlyProperty,
  PlyFormat,
  PlyDataType,
} from './ply-parser.js';

// Gaussian 数据模型
export {
  loadGaussiansFromPly,
  SH_C0,
  SPZ_COLOR_SCALE,
} from './gaussian-loader.js';
export type {
  GaussianSplat,
  GaussianCloud,
  LoadGaussianOptions,
} from './gaussian-loader.js';

// .splat 写入器
export { writeSplat, SPLAT_BYTES_PER_SPLAT } from './splat-writer.js';

// .splat 读取器 (从 .splat 反向加载为 GaussianCloud)
export { loadGaussiansFromSplat } from './splat-reader.js';
export type { LoadSplatOptions } from './splat-reader.js';

// SPZ 写入器
export {
  writeSpz,
  SPZ_MAGIC,
  SPZ_VERSION,
  SPZ_FLAG_ANTIALIASED,
} from './spz-writer.js';
export type { SpzWriterOptions } from './spz-writer.js';

// SOG 写入器
export { writeSog, parseSogMetadata } from './sog-writer.js';
export type {
  SogWriterOptions,
  SogChunkEntry,
  SogMetadata,
} from './sog-writer.js';

// 数据处理
export {
  pruneGaussians,
  mortonSortGaussians,
} from './processing.js';
export type {
  PruneOptions,
  MortonSortOptions,
} from './processing.js';
