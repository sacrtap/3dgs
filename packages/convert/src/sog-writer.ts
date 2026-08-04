/**
 * SOG 格式写入器 — 空间排序高斯 (Spatially Ordered Gaussians)
 *
 * SOG 是 PlayCanvas 开发的流式 LOD 格式, 基于 Morton Code 空间排序。
 * 本实现是一个简化的自包含二进制格式:
 *
 * Header (64 bytes):
 *   magic          4 bytes  = "SOG1"
 *   version        Uint16   = 1
 *   shDegree       Uint8
 *   reserved       Uint8    = 0
 *   numSplats      Uint32
 *   numChunks      Uint32
 *   chunkSize      Uint32   (splats per chunk)
 *   bboxMin        3 × Float32 (12 bytes)
 *   bboxMax        3 × Float32 (12 bytes)
 *   reserved2      16 bytes (padding)
 *
 * Chunk Index (numChunks × 8 bytes):
 *   offset  Uint32  — chunk data 在文件中的字节偏移
 *   size    Uint32  — chunk data 的字节大小
 *
 * Chunk Data:
 *   每个 chunk 包含 chunkSize 个 splat, 使用与 .splat 相同的 32 字节格式
 *   最后一个 chunk 可能不足 chunkSize
 *
 * 流式加载:
 *   1. 读取 64 字节 header → 获取 numChunks, chunkSize
 *   2. 读取 chunk index → 获取各 chunk 偏移
 *   3. 按需 fetch 各 chunk (使用 HTTP Range 请求)
 *   4. 前面的 chunk 先加载渲染, 后面的 chunk 逐步补充细节
 *
 * [来源: PlayCanvas SOG 格式 — developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/]
 * [来源: PlayCanvas 博客 — blog.playcanvas.com]
 */

import type { GaussianCloud } from './gaussian-loader.js';
import { writeSplat } from './splat-writer.js';
import { mortonSortGaussians } from './processing.js';

/** SOG 魔数 */
const SOG_MAGIC = 0x31474F53; // "SOG1" in LE

/** SOG 版本 */
const SOG_VERSION = 1;

/** SOG Header 大小 */
const SOG_HEADER_SIZE = 64;

/** 默认每 chunk 的 splat 数 */
const DEFAULT_CHUNK_SIZE = 16384;

/** SOG 写入选项 */
export interface SogWriterOptions {
  /** 每 chunk 的 splat 数 (默认 16384) */
  chunkSize?: number;
  /** 是否在写入前进行 Morton Code 排序 (默认 true) */
  spatialSort?: boolean;
}

/** SOG chunk 索引条目 */
export interface SogChunkEntry {
  /** chunk 在文件中的字节偏移 */
  offset: number;
  /** chunk 数据的字节大小 */
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
}

/**
 * 将 GaussianCloud 写入 SOG 格式
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

  // 4. 构建各 chunk 数据
  const chunks: SogChunkEntry[] = [];
  const chunkDataList: ArrayBuffer[] = [];

  for (let c = 0; c < numChunks; c++) {
    const start = c * chunkSize;
    const end = Math.min(start + chunkSize, numSplats);
    const count = end - start;

    // 提取子集
    const chunkCloud: GaussianCloud = {
      splats: splats.slice(start, end),
      shDegree: cloud.shDegree,
      vertexCount: count,
      source: cloud.source,
    };

    // 使用 .splat 格式写入 chunk 数据
    const chunkData = writeSplat(chunkCloud);
    chunkDataList.push(chunkData);
  }

  // 5. 计算偏移
  const headerSize = SOG_HEADER_SIZE;
  const indexSize = numChunks * 8; // 每条目 8 bytes (offset + size)
  let dataOffset = headerSize + indexSize;

  for (let c = 0; c < numChunks; c++) {
    chunks.push({
      offset: dataOffset,
      size: chunkDataList[c].byteLength,
      count: Math.min(chunkSize, numSplats - c * chunkSize),
    });
    dataOffset += chunkDataList[c].byteLength;
  }

  // 6. 组装最终文件
  const totalSize = dataOffset;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Header
  view.setUint32(0, SOG_MAGIC, true);
  view.setUint16(4, SOG_VERSION, true);
  view.setUint8(6, cloud.shDegree);
  view.setUint8(7, 0); // reserved
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
  // 16 bytes padding (offset 44-63) already zeroed

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

  return buffer;
}

/**
 * 从 SOG 文件解析元数据 (仅 header + chunk index, 不含数据)
 *
 * @param buffer SOG 文件的 ArrayBuffer (至少 header + index)
 * @returns SOG 元数据
 */
export function parseSogMetadata(buffer: ArrayBuffer): SogMetadata {
  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);
  if (magic !== SOG_MAGIC) {
    throw new Error(`无效的 SOG 文件: magic 不匹配`);
  }

  const version = view.getUint16(4, true);
  if (version !== SOG_VERSION) {
    throw new Error(`不支持的 SOG 版本: ${version}`);
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

  return {
    numSplats,
    numChunks,
    chunkSize,
    shDegree,
    bboxMin,
    bboxMax,
    chunks,
  };
}

/** 写入空的 SOG 文件 */
function writeEmptySog(): ArrayBuffer {
  const buffer = new ArrayBuffer(SOG_HEADER_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, SOG_MAGIC, true);
  view.setUint16(4, SOG_VERSION, true);
  // 其余字段为 0
  return buffer;
}
