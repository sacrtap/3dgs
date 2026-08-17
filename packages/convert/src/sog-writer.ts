/**
 * SOG 格式写入器 — 空间排序高斯 (Spatially Ordered Gaussians)
 *
 * SOG 是 PlayCanvas 开发的流式 LOD 格式, 基于 Morton Code 空间排序。
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  SOG v2 格式 (P1-2 + P1-3 优化)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Header (64 bytes):
 *    magic          4 bytes  = "SOG2" (0x32474F53)
 *    version        Uint16   = 2
 *    shDegree       Uint8
 *    compression    Uint8    = 0 (none) | 1 (gzip)    ← P1-2
 *    numSplats      Uint32
 *    numChunks      Uint32
 *    chunkSize      Uint32   (splats per chunk)
 *    bboxMin        3 × Float32 (12 bytes)
 *    bboxMax        3 × Float32 (12 bytes)
 *    lodTreeOffset  Uint32   ← M2: LOD 树偏移 (0 = 无预构建)
 *    lodTreeSize    Uint32   ← M2: LOD 树大小 (0 = 无预构建)
 *    lodQuality     Uint8    ← P1-3: LOD 质量 (0=fast, 1=quality)
 *    positionQuant  Uint8    ← P2-3: 位置量化 (0=off, 1=on)
 *    reserved       10 bytes (padding)
 *
 *  ★ M2: LOD Tree Section (at lodTreeOffset, 若 lodTreeSize > 0):
 *    numLevels      Uint32    — LOD 层级数 (通常 3-5)
 *    lodBase        Float32   — LOD 缩减因子 (1.5=fast, 1.75=quality)
 *    levels         numLevels × Uint32 — 每个 LOD 层级的累计 splat 数
 *
 *    基于 Morton 排序的前缀子集: LOD i 渲染前 levels[i] 个 splat。
 *    Morton 排序保证空间局部性, 前缀子集提供均匀空间覆盖。
 *
 *  Chunk Index (numChunks × 8 bytes):
 *    offset  Uint32  — chunk data 在文件中的字节偏移
 *    size    Uint32  — chunk data 的字节大小 (压缩后)
 *
 *  Chunk Data:
 *    默认: 每个 chunk 使用 .splat 32 字节格式
 *    ★ P2-3: 若 positionQuant=1, 使用紧凑 29 字节格式:
 *      Position XYZ  3 × Uint24 LE  (9 bytes)  — 量化: round((pos-min)/range*0xFFFFFF)
 *      Scale XYZ     3 × Float32    (12 bytes)
 *      Color RGBA    4 × Uint8      (4 bytes)
 *      Rotation IJKL 4 × Uint8      (4 bytes)
 *      总计: 29 bytes/splat (vs 32 bytes, -9%)
 *    若 compression=1, chunk 数据为 gzip 压缩后的数据
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  SOG v1 格式 (向后兼容)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  magic = "SOG1" (0x31474F53), version = 1
 *  无 compression, 无 LOD 字段
 *  读取器自动识别 v1/v2 并回退
 *
 * [来源: PlayCanvas SOG 格式 — developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/]
 * [来源: P1-2 gzip 压缩 — node:zlib]
 * [来源: P1-3 LOD 元数据 — Spark createLodSplats quality 参数]
 * [来源: P2-3 位置量化 — SPZ 格式 24-bit 定点量化, github.com/nianticlabs/spz]
 * [来源: M2 SOG 原生 LOD 索引 — Morton 前缀子集, 独立于 Spark WASM 内部格式]
 */

import { gzipSync } from 'node:zlib';
import type { GaussianCloud, GaussianSplat } from './gaussian-loader.js';
import { writeSplat } from './splat-writer.js';
import { mortonSortGaussians } from './processing.js';

/** SOG v1 魔数 */
const SOG_MAGIC_V1 = 0x31474F53; // "SOG1" in LE

/** SOG v2 魔数 */
const SOG_MAGIC_V2 = 0x32474F53; // "SOG2" in LE

/** ★ L2: SOG v3 魔数 — SH overlay 分层加载 */
export const SOG_MAGIC_V3 = 0x33474F53; // "SOG3" in LE

/** ★ L2: SOG v3 版本 */
export const SOG_VERSION_V3 = 3;

/** ★ L2: SH overlay header 大小 (overlayOffset: 4B + overlaySize: 4B + shDegree: 1B + shMode: 1B + reserved: 2B = 12B) */
export const SOG_V3_OVERLAY_HEADER_SIZE = 12;

/** SOG 版本 */
const SOG_VERSION_V1 = 1;
const SOG_VERSION_V2 = 2;

/** SOG Header 大小 */
const SOG_HEADER_SIZE = 64;

/** ★ M4: 默认每 chunk 的 splat 数 (从 16384 调小到 8192, 首屏加载更快) */
const DEFAULT_CHUNK_SIZE = 8192;

/** 压缩方式 */
export const SOG_COMPRESSION_NONE = 0;
export const SOG_COMPRESSION_GZIP = 1;

/** ★ P2-3: 位置量化标志 */
export const SOG_POSITION_QUANT_OFF = 0;
export const SOG_POSITION_QUANT_24BIT = 1;

/** ★ P2-3: 紧凑格式每 splat 字节数 (29 bytes: 9 + 12 + 4 + 4) */
export const SOG_COMPACT_BYTES_PER_SPLAT = 29;

/** ★ P2-3: 24-bit 量化最大值 */
const QUANT_MAX = 0xFFFFFF; // 16777215

/** ★ H2: SH DC 追加模式 */
export const SOG_SH_MODE_OFF = 0;       // 不追加 SH DC
export const SOG_SH_MODE_DC_INT8 = 1;   // 追加 SH DC 3 bytes (Int8 量化)

/** ★ H2: SH DC 追加后每 splat 额外字节数 (3 bytes: R, G, B 各 1 byte) */
const SH_DC_EXTRA_BYTES = 3;

/** ★ H2: SH C0 常数 (球谐函数第 0 阶) */
const SH_C0 = 0.28209479177387814;

/** ★ H2: SPZ 颜色缩放常数 */
const SPZ_COLOR_SCALE = 0.15;

/** ★ M2: LOD 树默认层级数 */
const DEFAULT_LOD_LEVELS = 4;

/** ★ M2: LOD 树默认缩减因子 (对应 Spark quality=true 的 1.75) */
const DEFAULT_LOD_BASE_QUALITY = 1.75;

/** ★ M2: LOD 树默认缩减因子 (对应 Spark quality=false 的 1.5) */
const DEFAULT_LOD_BASE_FAST = 1.5;

/** ★ M2: LOD 树最小 splat 数 (最粗 LOD 层级至少保留的 splat 数) */
const MIN_LOD_SPLATS = 100;

/** ★ M2: LOD 树二进制头大小 (numLevels: 4B + lodBase: 4B = 8B) */
const LOD_TREE_HEADER_SIZE = 8;

/** SOG 写入选项 */
export interface SogWriterOptions {
  /** 每 chunk 的 splat 数 (默认 16384) */
  chunkSize?: number;
  /** 是否在写入前进行 Morton Code 空间排序 (默认 true) */
  spatialSort?: boolean;
  /** ★ P1-2: 是否启用 gzip 压缩 chunk 数据 (默认 true) */
  compression?: boolean;
  /** ★ P1-3: LOD 质量 (0=fast, 1=quality, 默认 1) */
  lodQuality?: number;
  /**
   * ★ P2-3: 是否启用 24-bit 位置量化 (默认 false)
   *
   * 启用后, chunk 数据使用紧凑 29 字节格式 (位置 3×Uint24, 其余不变),
   * 传输大小减少 ~9%。读取时在客户端反量化为 Float32。
   *
   * 精度: sceneSize / 2^24 ≈ 6μm (100m 场景)
   *
   * [来源: SPZ 格式 — github.com/nianticlabs/spz, 位置 24-bit 定点]
   */
  positionQuantization?: boolean;
  /**
   * ★ H2: SH DC 追加模式 (默认 0 = 不追加)
   *
   * 设为 1 时, 每个 splat 额外追加 3 字节 SH DC 数据 (Int8 量化),
   * 为 SH-aware 着色器提供视角依赖着色数据。
   *
   * 文件大小增加: +3 bytes/splat (+9.4% for 32B format)
   *
   * [来源: 会议决策 H2 — docs/party-mode-memories/2026-08-17-convert-quality-loss-memory.md]
   */
  shMode?: number;
  /**
   * ★ M2: 是否启用预构建 LOD 树 (默认 true)
   *
   * 启用后, 在 SOG 文件末尾写入 LOD 层级索引数据。
   * 客户端可直接读取 LOD 层级, 无需运行时构建。
   *
   * LOD 层级基于 Morton 排序的前缀子集:
   *   - Morton 排序保证空间局部性 (邻近的 splat 在数组中也相邻)
   *   - 前缀子集提供均匀空间覆盖 (适用于粗粒度 LOD)
   *   - lodBase 控制缩减因子: level i 的 splat 数 ≈ numSplats / lodBase^(numLevels-1-i)
   *
   * 与 Spark 内部 lodTree 的区别:
   *   - Spark lodTree 是 WASM 内部不透明 Uint32Array, 格式未公开, 无法在 Node.js 中生成
   *   - SOG 原生 LOD 索引是公开格式, 独立于 Spark, 可在离线转换阶段预计算
   *
   * [来源: M2 SOG 原生 LOD — Morton Z-order 前缀子集空间覆盖特性]
   */
  buildLodTree?: boolean;
  /**
   * ★ M2: LOD 层级数 (默认 4)
   *
   * 仅在 buildLodTree=true 时生效。
   * 层级越多, LOD 过渡越平滑, 但每级间的差异越小。
   */
  lodLevels?: number;
}

/** SOG chunk 索引条目 */
export interface SogChunkEntry {
  /** chunk 在文件中的字节偏移 */
  offset: number;
  /** chunk 数据的字节大小 (压缩后) */
  size: number;
  /** chunk 中的 splat 数 */
  count: number;
}

/** SOG 文件元数据 */
export interface SogMetadata {
  numSplats: number;
  numChunks: number;
  chunkSize: number;
  shDegree: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  chunks: SogChunkEntry[];
  /** ★ P1-2: 压缩方式 (0=none, 1=gzip) */
  compression: number;
  /** ★ M2: LOD 树偏移 (0 = 无预构建 LOD) */
  lodTreeOffset: number;
  /** ★ M2: LOD 树大小 (0 = 无预构建 LOD) */
  lodTreeSize: number;
  /** ★ P1-3: LOD 质量 (0=fast, 1=quality) */
  lodQuality: number;
  /** ★ P2-3: 位置量化 (0=off, 1=24-bit) */
  positionQuantization: number;
  /** ★ H2: SH DC 追加模式 (0=off, 1=Int8) */
  shMode: number;
  /** ★ 格式版本 */
  version: number;
  /**
   * ★ M2: 预构建 LOD 层级 (累计 splat 数)
   *
   * 若 lodTreeSize > 0, 此字段包含每个 LOD 层级的累计 splat 数。
   * levels[0] = 最粗 LOD 的 splat 数 (前缀子集大小)
   * levels[levels.length-1] = numSplats (全部)
   *
   * 客户端可根据相机距离选择合适的 LOD 层级,
   * 仅渲染前 levels[i] 个 splat (Morton 排序保证空间覆盖)。
   *
   * 若 lodTreeSize = 0, 此字段为 undefined (需运行时构建)。
   */
  lodLevels?: number[];
  /**
   * ★ M2: LOD 缩减因子
   *
   * level i 的 splat 数 ≈ numSplats / lodBase^(numLevels-1-i)
   * 1.5 = fast (更激进缩减), 1.75 = quality (更保守缩减)
   */
  lodBase?: number;
}

/**
 * 将 GaussianCloud 写入 SOG v2 格式
 *
 * @param cloud 高斯核集合
 * @param options 写入选项
 * @returns SOG 格式的 ArrayBuffer
 */
export function writeSog(
  cloud: GaussianCloud,
  options: SogWriterOptions = {},
): ArrayBuffer {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    spatialSort = true,
    compression = true,
    lodQuality = 1,
    positionQuantization = false,
    buildLodTree = true,
    lodLevels: numLodLevels = DEFAULT_LOD_LEVELS,
    shMode = SOG_SH_MODE_OFF,
  } = options;

  // 1. 可选: Morton Code 空间排序
  const sorted = spatialSort ? mortonSortGaussians(cloud) : cloud;
  const splats = sorted.splats;
  const numSplats = splats.length;

  if (numSplats === 0) {
    return writeEmptySog();
  }

  // 2. 计算包围盒
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of splats) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.z < minZ) minZ = s.z;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
    if (s.z > maxZ) maxZ = s.z;
  }

  // 3. 分块
  const numChunks = Math.ceil(numSplats / chunkSize);

  // 4. 构建各 chunk 数据 (带 gzip 压缩)
  const chunks: SogChunkEntry[] = [];
  const chunkDataList: ArrayBuffer[] = [];

  for (let c = 0; c < numChunks; c++) {
    const start = c * chunkSize;
    const end = Math.min(start + chunkSize, numSplats);
    const count = end - start;

    const chunkCloud: GaussianCloud = {
      splats: splats.slice(start, end),
      shDegree: cloud.shDegree,
      vertexCount: count,
      source: cloud.source,
    };

    // 使用 .splat 格式或 ★ P2-3 紧凑格式写入 chunk 数据
    let rawChunkData: ArrayBuffer;
    if (positionQuantization) {
      // ★ M1: 借鉴 SuperSplat chunk 级量化 — 每个 chunk 独立计算 local bbox
      // 局部量化比全局量化精度更高 (chunk 范围 << 全局范围)
      let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
      let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
      for (let j = start; j < end; j++) {
        const s = splats[j];
        if (s.x < cMinX) cMinX = s.x;
        if (s.y < cMinY) cMinY = s.y;
        if (s.z < cMinZ) cMinZ = s.z;
        if (s.x > cMaxX) cMaxX = s.x;
        if (s.y > cMaxY) cMaxY = s.y;
        if (s.z > cMaxZ) cMaxZ = s.z;
      }
      rawChunkData = writeCompactSplatChunk(
        chunkCloud.splats,
        [cMinX, cMinY, cMinZ],
        [cMaxX, cMaxY, cMaxZ],
        // ★ M1: chunk local bbox 作为前缀 (6 × Float32 = 24 bytes)
        true,
      );
    } else {
      rawChunkData = writeSplat(chunkCloud);
    }

    // ★ H2: 追加 SH DC 数据到 chunk 末尾
    if (shMode === SOG_SH_MODE_DC_INT8) {
      rawChunkData = appendShDc(rawChunkData, chunkCloud.splats);
    }

    // ★ M4: gzip 压缩 chunk 数据 (level 6→9, 更高压缩率, 传输更小)
    if (compression) {
      const compressed = gzipSync(Buffer.from(rawChunkData), { level: 9 });
      chunkDataList.push(compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength));
    } else {
      chunkDataList.push(rawChunkData);
    }
  }

  // 5. 计算偏移 (v2: header + chunk index + chunk data + 可选 LOD tree)
  const headerSize = SOG_HEADER_SIZE;
  const indexSize = numChunks * 8;
  let dataOffset = headerSize + indexSize;

  for (let c = 0; c < numChunks; c++) {
    chunks.push({
      offset: dataOffset,
      size: chunkDataList[c].byteLength,
      count: Math.min(chunkSize, numSplats - c * chunkSize),
    });
    dataOffset += chunkDataList[c].byteLength;
  }

  // ★ M2: 构建预构建 LOD 树
  let lodTreeOffset = 0;
  let lodTreeSize = 0;
  let lodTreeBuffer: ArrayBuffer | null = null;

  if (buildLodTree && numSplats > MIN_LOD_SPLATS) {
    const lodBaseVal = lodQuality === 1 ? DEFAULT_LOD_BASE_QUALITY : DEFAULT_LOD_BASE_FAST;
    const levels = buildLodLevels(numSplats, numLodLevels, lodBaseVal);
    lodTreeBuffer = serializeLodTree(levels, lodBaseVal);
    lodTreeOffset = dataOffset; // LOD 树紧跟在 chunk data 之后
    lodTreeSize = lodTreeBuffer.byteLength;
  }

  // 6. 组装最终文件
  const totalSize = dataOffset + (lodTreeBuffer?.byteLength ?? 0);
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // ★ Header (v2)
  view.setUint32(0, SOG_MAGIC_V2, true);           // magic "SOG2"
  view.setUint16(4, SOG_VERSION_V2, true);          // version 2
  view.setUint8(6, cloud.shDegree);                  // shDegree
  view.setUint8(7, compression ? SOG_COMPRESSION_GZIP : SOG_COMPRESSION_NONE); // compression
  view.setUint32(8, numSplats, true);
  view.setUint32(12, numChunks, true);
  view.setUint32(16, chunkSize, true);

  // Bounding box
  view.setFloat32(20, minX, true);
  view.setFloat32(24, minY, true);
  view.setFloat32(28, minZ, true);
  view.setFloat32(32, maxX, true);
  view.setFloat32(36, maxY, true);
  view.setFloat32(40, maxZ, true);

  // ★ M2: LOD 元数据 (offset 44-56)
  view.setUint32(44, lodTreeOffset, true);              // lodTreeOffset (0 = 无预构建)
  view.setUint32(48, lodTreeSize, true);                // lodTreeSize (0 = 无预构建)
  view.setUint8(52, lodQuality);                      // lodQuality (0=fast, 1=quality)
  // ★ P2-3: 位置量化标志 (byte 53)
  view.setUint8(53, positionQuantization ? SOG_POSITION_QUANT_24BIT : SOG_POSITION_QUANT_OFF);
  // ★ H2: SH DC 模式 (byte 54, 旧版文件此字节为 0 = 无 SH DC, 兼容)
  view.setUint8(54, shMode);
  // 9 bytes padding (55-63) already zeroed

  // Chunk index
  for (let c = 0; c < numChunks; c++) {
    const base = headerSize + c * 8;
    view.setUint32(base, chunks[c].offset, true);
    view.setUint32(base + 4, chunks[c].size, true);
  }

  // Chunk data
  for (let c = 0; c < numChunks; c++) {
    u8.set(new Uint8Array(chunkDataList[c]), chunks[c].offset);
  }

  // ★ M2: LOD tree data (紧跟在 chunk data 之后)
  if (lodTreeBuffer) {
    u8.set(new Uint8Array(lodTreeBuffer), lodTreeOffset);
  }

  return buffer;
}

/**
 * 从 SOG 文件解析元数据 (仅 header + chunk index, 不含数据)
 *
 * 支持 v1 和 v2 格式:
 *   v1 ("SOG1"): 无压缩, 无 LOD 字段
 *   v2 ("SOG2"): 有 compression, lodQuality 等字段
 *
 * @param buffer SOG 文件的 ArrayBuffer (至少 header + index)
 * @returns SOG 元数据
 */
export function parseSogMetadata(buffer: ArrayBuffer): SogMetadata {
  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);

  let version: number;
  let compression = SOG_COMPRESSION_NONE;
  let lodTreeOffset = 0;
  let lodTreeSize = 0;
  let lodQuality = 0;
  let positionQuantization = SOG_POSITION_QUANT_OFF;
  let shMode = SOG_SH_MODE_OFF;

  if (magic === SOG_MAGIC_V2) {
    // ★ SOG v2 — 读取新字段
    version = SOG_VERSION_V2;
    compression = view.getUint8(7);
    lodTreeOffset = view.getUint32(44, true);
    lodTreeSize = view.getUint32(48, true);
    lodQuality = view.getUint8(52);
    // ★ P2-3: 读取位置量化标志 (byte 53)
    // 旧版 v2 文件此字节为 0 (reserved), 兼容
    positionQuantization = view.getUint8(53);
    // ★ H2: 读取 SH DC 模式 (byte 54)
    // 旧版 v2 文件此字节为 0 (reserved), 兼容
    shMode = view.getUint8(54);
  } else if (magic === SOG_MAGIC_V1) {
    // ★ SOG v1 — 向后兼容, 无新字段
    version = SOG_VERSION_V1;
  } else {
    throw new Error(`无效的 SOG 文件: magic 不匹配 (0x${magic.toString(16)})`);
  }

  const versionField = view.getUint16(4, true);
  if (versionField !== version) {
    throw new Error(`SOG 版本字段不匹配: 期望 ${version}, 得到 ${versionField}`);
  }

  const shDegree = view.getUint8(6);
  const numSplats = view.getUint32(8, true);
  const numChunks = view.getUint32(12, true);
  const chunkSize = view.getUint32(16, true);

  const bboxMin: [number, number, number] = [
    view.getFloat32(20, true),
    view.getFloat32(24, true),
    view.getFloat32(28, true),
  ];
  const bboxMax: [number, number, number] = [
    view.getFloat32(32, true),
    view.getFloat32(36, true),
    view.getFloat32(40, true),
  ];

  const chunks: SogChunkEntry[] = [];
  for (let c = 0; c < numChunks; c++) {
    const base = SOG_HEADER_SIZE + c * 8;
    chunks.push({
      offset: view.getUint32(base, true),
      size: view.getUint32(base + 4, true),
      count: Math.min(chunkSize, numSplats - c * chunkSize),
    });
  }

  // ★ M2: 解析预构建 LOD 树数据
  let lodLevels: number[] | undefined;
  let lodBase: number | undefined;
  if (lodTreeOffset > 0 && lodTreeSize > 0 && lodTreeOffset + lodTreeSize <= buffer.byteLength) {
    const lodView = new DataView(buffer, lodTreeOffset, lodTreeSize);
    const numLevels = lodView.getUint32(0, true);
    lodBase = lodView.getFloat32(4, true);
    lodLevels = [];
    for (let i = 0; i < numLevels; i++) {
      lodLevels.push(lodView.getUint32(LOD_TREE_HEADER_SIZE + i * 4, true));
    }
  }

  return {
    numSplats,
    numChunks,
    chunkSize,
    shDegree,
    bboxMin,
    bboxMax,
    chunks,
    compression,
    lodTreeOffset,
    lodTreeSize,
    lodQuality,
    positionQuantization,
    shMode,
    version,
    lodLevels,
    lodBase,
  };
}

/** 写入空的 SOG v2 文件 */
function writeEmptySog(): ArrayBuffer {
  const buffer = new ArrayBuffer(SOG_HEADER_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, SOG_MAGIC_V2, true);
  view.setUint16(4, SOG_VERSION_V2, true);
  view.setUint8(7, SOG_COMPRESSION_NONE);
  view.setUint8(53, SOG_POSITION_QUANT_OFF); // P2-3: 位置量化关闭
  view.setUint8(54, SOG_SH_MODE_OFF); // H2: SH DC 关闭
  // 其余字段为 0
  return buffer;
}

/** 导出常量供外部使用 */
export {
  SOG_MAGIC_V1, SOG_MAGIC_V2, SOG_VERSION_V1, SOG_VERSION_V2, SOG_HEADER_SIZE,
  DEFAULT_LOD_LEVELS, DEFAULT_LOD_BASE_QUALITY, DEFAULT_LOD_BASE_FAST, MIN_LOD_SPLATS, LOD_TREE_HEADER_SIZE,
};

// ─── M2: LOD 树构建与序列化 ───────────────────────────────

/**
 * ★ M2: 构建 LOD 层级 (基于 Morton 排序前缀子集)
 *
 * LOD 层级计算公式:
 *   level i 的 splat 数 = max(MIN_LOD_SPLATS, floor(numSplats / lodBase^(numLevels-1-i)))
 *
 * 其中 i=0 是最粗 LOD (最少 splat), i=numLevels-1 是最精细 LOD (全部 splat)。
 *
 * Morton 排序保证空间局部性: 前缀子集包含来自整个场景的均匀分布的 splat,
 * 因为 Morton Code (Z-order) 在空间上均匀采样。
 *
 * 示例 (numSplats=100000, numLevels=4, lodBase=1.75):
 *   level 0: max(100, floor(100000 / 1.75^3)) = max(100, 18657) = 18657
 *   level 1: max(100, floor(100000 / 1.75^2)) = max(100, 32653) = 32653
 *   level 2: max(100, floor(100000 / 1.75^1)) = max(100, 57142) = 57142
 *   level 3: 100000 (全部)
 *
 * [来源: Morton Z-order 空间覆盖特性 — en.wikipedia.org/wiki/Z-order_curve]
 * [来源: Spark lodBase 参数 — spark.module.js:14783 lodBase = quality ? 1.75 : 1.5]
 *
 * @param numSplats 总 splat 数
 * @param numLevels LOD 层级数 (通常 3-5)
 * @param lodBase LOD 缩减因子 (1.5=fast, 1.75=quality)
 * @returns 每个 LOD 层级的累计 splat 数 (单调递增, 最后一个 = numSplats)
 */
export function buildLodLevels(
  numSplats: number,
  numLevels: number,
  lodBase: number,
): number[] {
  if (numSplats <= 0 || numLevels <= 0) {
    return [numSplats];
  }

  const levels: number[] = [];
  for (let i = 0; i < numLevels - 1; i++) {
    // level i 的缩减指数: numLevels-1-i
    // i=0 (最粗) → 指数最大 → splat 最少
    // i=numLevels-2 → 指数=1 → splat 较多
    const exponent = numLevels - 1 - i;
    const factor = Math.pow(lodBase, exponent);
    const count = Math.max(MIN_LOD_SPLATS, Math.floor(numSplats / factor));
    levels.push(count);
  }
  // 最后一个 level = 全部 splat
  levels.push(numSplats);

  // 确保单调递增 (lodBase < 1 时可能不满足, 但正常情况不会)
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] < levels[i - 1]) {
      levels[i] = levels[i - 1];
    }
  }

  return levels;
}

/**
 * ★ M2: 序列化 LOD 树为二进制数据
 *
 * 二进制格式:
 *   numLevels  Uint32    — LOD 层级数
 *   lodBase    Float32   — LOD 缩减因子
 *   levels     numLevels × Uint32 — 每个 LOD 层级的累计 splat 数
 *
 * 总大小: 8 + numLevels × 4 字节
 *
 * @param levels LOD 层级数组 (累计 splat 数)
 * @param lodBase LOD 缩减因子
 * @returns 序列化后的 ArrayBuffer
 */
export function serializeLodTree(levels: number[], lodBase: number): ArrayBuffer {
  const numLevels = levels.length;
  const bufferSize = LOD_TREE_HEADER_SIZE + numLevels * 4;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  view.setUint32(0, numLevels, true);
  view.setFloat32(4, lodBase, true);

  for (let i = 0; i < numLevels; i++) {
    view.setUint32(LOD_TREE_HEADER_SIZE + i * 4, levels[i], true);
  }

  return buffer;
}

/**
 * ★ M2: 从二进制数据反序列化 LOD 树
 *
 * @param buffer 包含 LOD 树数据的 ArrayBuffer
 * @returns { levels, lodBase } 或 null (如果数据无效)
 */
export function deserializeLodTree(buffer: ArrayBuffer): {
  levels: number[];
  lodBase: number;
} | null {
  if (buffer.byteLength < LOD_TREE_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer);
  const numLevels = view.getUint32(0, true);
  const lodBase = view.getFloat32(4, true);

  if (numLevels === 0 || numLevels > 100) {
    return null; // 合理性检查
  }

  const expectedSize = LOD_TREE_HEADER_SIZE + numLevels * 4;
  if (buffer.byteLength < expectedSize) {
    return null;
  }

  const levels: number[] = [];
  for (let i = 0; i < numLevels; i++) {
    levels.push(view.getUint32(LOD_TREE_HEADER_SIZE + i * 4, true));
  }

  return { levels, lodBase };
}

// ─── H2: SH DC 追加 ─────────────────────────────────────

/**
 * ★ H2: 在 chunk 数据末尾追加 SH DC 系数 (3 bytes/splat, Int8 量化)
 *
 * SH DC 编码公式 (与 SPZ 一致):
 *   byte = clamp(((color - 0.5) / (SH_C0 / SPZ_COLOR_SCALE) + 0.5) * 255)
 *
 * 追加后的 chunk 格式:
 *   [原始 splat 数据 (32B 或 29B/splat)] + [SH DC R,G,B (3B/splat)]
 *
 * @param rawChunkData 原始 chunk 数据 (无 SH)
 * @param splats 高斯核数组
 * @returns 追加 SH DC 后的 ArrayBuffer
 */
function appendShDc(rawChunkData: ArrayBuffer, splats: GaussianSplat[]): ArrayBuffer {
  const numSplats = splats.length;
  const originalSize = rawChunkData.byteLength;
  const newSize = originalSize + numSplats * SH_DC_EXTRA_BYTES;
  const result = new ArrayBuffer(newSize);
  new Uint8Array(result).set(new Uint8Array(rawChunkData), 0);

  const view = new DataView(result, originalSize);
  for (let i = 0; i < numSplats; i++) {
    const s = splats[i];
    const base = i * SH_DC_EXTRA_BYTES;
    view.setUint8(base + 0, scaleColorToShDc(s.colorR));
    view.setUint8(base + 1, scaleColorToShDc(s.colorG));
    view.setUint8(base + 2, scaleColorToShDc(s.colorB));
  }

  return result;
}

/**
 * ★ H2: 颜色 → SH DC Int8 编码
 *
 * 编码: byte = clamp(((color - 0.5) / (SH_C0 / SPZ_COLOR_SCALE) + 0.5) * 255)
 * 解码: color = (byte / 255 - 0.5) * (SH_C0 / SPZ_COLOR_SCALE) + 0.5
 *
 * [来源: SPZ 颜色编码 — packages/convert/src/spz-writer.ts scaleRgbToSpz]
 */
function scaleColorToShDc(color: number): number {
  const colorScale = SH_C0 / SPZ_COLOR_SCALE; // ≈ 1.8806
  const v = ((color - 0.5) / colorScale + 0.5) * 255;
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ─── P2-3: 紧凑格式写入 ───────────────────────────────────

/**
 * ★ P2-3 + M1: 将 splat 数据写入紧凑 29 字节格式
 *
 * 格式 (29 bytes/splat):
 *   Position XYZ  3 × Uint24 LE  (9 bytes)  — 量化: round((pos-min)/range*0xFFFFFF)
 *   Scale XYZ     3 × Float32    (12 bytes)
 *   Color RGBA    4 × Uint8      (4 bytes)
 *   Rotation IJKL 4 × Uint8      (4 bytes)
 *
 * ★ M1: 当 includeBbox=true 时, 在 chunk 数据前追加 local bbox (6 × Float32 = 24 bytes)
 *   客户端反量化时读取前 24 字节获取 chunk local bbox, 提高精度
 *
 * 量化精度:
 *   全局量化: sceneSize / 2^24 ≈ 6μm (100m 场景)
 *   ★ M1 局部量化: chunkSize / 2^24 ≈ 0.06μm (10m chunk, 精度提升 100×)
 *
 * [来源: SPZ 格式 — github.com/nianticlabs/spz, 位置 24-bit 定点]
 * [来源: SuperSplat chunk 级量化 — 每个 chunk 独立 min/max, node_modules/@sparkjsdev/spark]
 *
 * @param splats 高斯核数组
 * @param bboxMin chunk 包围盒最小值 (★ M1: 局部 bbox)
 * @param bboxMax chunk 包围盒最大值 (★ M1: 局部 bbox)
 * @param includeBbox ★ M1: 是否在数据前追加 bbox (6 × Float32 = 24 bytes)
 * @returns 紧凑格式的 ArrayBuffer
 */
function writeCompactSplatChunk(
  splats: GaussianSplat[],
  bboxMin: [number, number, number],
  bboxMax: [number, number, number],
  includeBbox: boolean = false,
): ArrayBuffer {
  const numSplats = splats.length;
  const bboxHeaderSize = includeBbox ? 24 : 0; // 6 × Float32
  const buffer = new ArrayBuffer(bboxHeaderSize + numSplats * SOG_COMPACT_BYTES_PER_SPLAT);
  const view = new DataView(buffer);

  // ★ M1: 写入 chunk local bbox 前缀
  if (includeBbox) {
    view.setFloat32(0, bboxMin[0], true);
    view.setFloat32(4, bboxMin[1], true);
    view.setFloat32(8, bboxMin[2], true);
    view.setFloat32(12, bboxMax[0], true);
    view.setFloat32(16, bboxMax[1], true);
    view.setFloat32(20, bboxMax[2], true);
  }

  const rangeX = (bboxMax[0] - bboxMin[0]) || 1;
  const rangeY = (bboxMax[1] - bboxMin[1]) || 1;
  const rangeZ = (bboxMax[2] - bboxMin[2]) || 1;

  for (let i = 0; i < numSplats; i++) {
    const s = splats[i];
    const byteBase = bboxHeaderSize + i * SOG_COMPACT_BYTES_PER_SPLAT;

    // Position XYZ → 3 × Uint24 LE (9 bytes at offset 0-8)
    const qx = quantizePos(s.x, bboxMin[0], rangeX);
    const qy = quantizePos(s.y, bboxMin[1], rangeY);
    const qz = quantizePos(s.z, bboxMin[2], rangeZ);
    writeUint24LE(view, byteBase + 0, qx);
    writeUint24LE(view, byteBase + 3, qy);
    writeUint24LE(view, byteBase + 6, qz);

    // Scale XYZ → 3 × Float32 (12 bytes at offset 9-20)
    // Float32 数组从字节 9 开始, 但 Float32 需要 4 字节对齐
    // 使用 DataView 直接写入
    view.setFloat32(byteBase + 9, s.scaleX, true);
    view.setFloat32(byteBase + 13, s.scaleY, true);
    view.setFloat32(byteBase + 17, s.scaleZ, true);

    // Color RGBA → 4 × Uint8 (4 bytes at offset 21-24)
    view.setUint8(byteBase + 21, clampU8(Math.round(s.colorR * 255)));
    view.setUint8(byteBase + 22, clampU8(Math.round(s.colorG * 255)));
    view.setUint8(byteBase + 23, clampU8(Math.round(s.colorB * 255)));
    view.setUint8(byteBase + 24, clampU8(Math.round(s.opacity * 255)));

    // Rotation IJKL → 4 × Uint8 (4 bytes at offset 25-28)
    view.setUint8(byteBase + 25, clampU8(Math.round(s.rotW * 128) + 128));
    view.setUint8(byteBase + 26, clampU8(Math.round(s.rotX * 128) + 128));
    view.setUint8(byteBase + 27, clampU8(Math.round(s.rotY * 128) + 128));
    view.setUint8(byteBase + 28, clampU8(Math.round(s.rotZ * 128) + 128));
  }

  return buffer;
}

/** 位置量化: round((pos - min) / range * 0xFFFFFF), clamped to [0, 0xFFFFFF] */
function quantizePos(value: number, min: number, range: number): number {
  return Math.max(0, Math.min(QUANT_MAX, Math.round((value - min) / range * QUANT_MAX)));
}

/** 写入 24-bit 无符号整数 (little-endian) */
function writeUint24LE(view: DataView, offset: number, value: number): void {
  view.setUint8(offset, value & 0xff);
  view.setUint8(offset + 1, (value >> 8) & 0xff);
  view.setUint8(offset + 2, (value >> 16) & 0xff);
}

/** Clamp to 0-255 */
function clampU8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
