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
export {
  writeSog,
  parseSogMetadata,
  buildLodLevels,
  serializeLodTree,
  deserializeLodTree,
  SOG_MAGIC_V1,
  SOG_MAGIC_V2,
  SOG_VERSION_V1,
  SOG_VERSION_V2,
  SOG_HEADER_SIZE,
  SOG_COMPRESSION_NONE,
  SOG_COMPRESSION_GZIP,
  SOG_POSITION_QUANT_OFF,
  SOG_POSITION_QUANT_24BIT,
  SOG_COMPACT_BYTES_PER_SPLAT,
  DEFAULT_LOD_LEVELS,
  DEFAULT_LOD_BASE_QUALITY,
  DEFAULT_LOD_BASE_FAST,
  MIN_LOD_SPLATS,
  LOD_TREE_HEADER_SIZE,
} from './sog-writer.js';
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
