/**
 * SPZ 格式读取器 — Niantic Labs SPZ v1-v4
 *
 * 支持:
 *   - v1: legacy float16 positions (6B/点, 从未正式发布, 仅兼容读取)
 *   - v2: 24-bit fixed positions + 3B 旋转 (xyz 8-bit signed, w 推导)
 *   - v3: 24-bit fixed positions + 4B 旋转 (smallest-three 编码)
 *   - v4: NGSP 明文 header + TOC + 6 条独立 zstd 属性流
 *
 * 文件检测:
 *   bytes[0..3] == "NGSP"      → v4 zstd 格式
 *   bytes[0..1] == 0x1f 0x8b   → legacy gzip 格式 (v1-v3, 整文件 gzip)
 *
 * [来源: Niantic spz 源码 — src/cc/load-spz.cc, splat-utils.h (2026-09-13 访问)]
 */

import type { GaussianCloud, GaussianCloudSoA } from './gaussian-loader.js';
import { fromSoA } from './gaussian-loader.js';

/** SPZ 魔数 = 0x5053474e ("NGSP" LE), 与 Niantic NGSP_MAGIC 一致 */
export const SPZ_MAGIC = 1347635022;

/** 最小支持 smallest-three 四元数编码的版本 (v3+) */
export const MIN_SMALLEST_THREE_QUATERNIONS_VERSION = 3;

/** 最小使用 zstd NGSP 容器的版本 (v4) */
export const MIN_ZSTD_SPZ_HEADER_VERSION = 4;

/** SH degree → 每通道系数数 */
const SH_DIM: Record<number, number> = { 0: 0, 1: 3, 2: 8, 3: 15, 4: 24 };

/** sqrt(1/2), smallest-three 编码的幅度缩放因子 */
const SQRT1_2 = 0.7071067811865476;

/** SH DC 缩放常数 (与 spz-writer 一致) */
const SH_C0 = 0.28209479177387814;
const SPZ_COLOR_SCALE = 0.15;

/** 解析后的 SPZ 头信息 (v1-v4 统一) */
export interface SpzHeaderInfo {
  /** 格式版本 (1-4) */
  version: number;
  /** 高斯点数 */
  numPoints: number;
  /** SH 阶数 (0-4) */
  shDegree: number;
  /** 位置量化小数位 */
  fractionalBits: number;
  /** 是否标记抗锯齿 */
  antialiased: boolean;
  /** 容器类型 */
  container: 'gzip' | 'ngsp';
  /** v4: 属性流数量 */
  numStreams?: number;
  /** v4: TOC 字节偏移 */
  tocByteOffset?: number;
}

/** v4 zstd 解压器签名 (可由调用方注入, 未注入时 v4 抛错) */
export type ZstdDecompressFn = (
  compressed: Uint8Array,
  uncompressedSize: number,
) => Uint8Array | Promise<Uint8Array>;

/** 读取选项 */
export interface SpzReadOptions {
  /** 数据来源描述 (透传给 GaussianCloudSoA.source) */
  source?: string;
  /**
   * v4 zstd 解压器。浏览器/Node 可用 fzstd.decompress ([数据], 容量)；
   * Node 24+ 可用 zlib.createZstdDecompress 的同步封装。缺省时读取 v4 抛错。
   */
  zstdDecompress?: ZstdDecompressFn;
}

/** 读取选项别名 (与其它 loader 命名一致) */
export type LoadSpzOptions = SpzReadOptions;

/**
 * 解析 SPZ 文件头 (不反序列化属性体)
 *
 * legacy gzip 文件需要整体解压后才能读到 16B header；
 * ngsp (v4) 文件 header 为 32B 明文。
 * 同步解析 gzip 文件的调用方请使用 {@link parseLegacyHeader} (解压后调用)。
 *
 * @param data SPZ 文件字节
 * @returns 头信息 (v4 需要解压器))
 * @throws 未识别格式 / 解压失败
 */
export async function parseSpzHeader(data: Uint8Array): Promise<SpzHeaderInfo> {
  if (data.length >= 4 && isNgspMagic(data)) {
    return parseNgspHeader(data);
  }
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    const decompressed = await gzipDecompress(data);
    return parseLegacyHeader(decompressed);
  }
  throw new Error('[spz-reader] 无法识别的 SPZ 格式: 不是 gzip (0x1f 0x8b) 也不是 NGSP magic');
}

/** 从已解压的 legacy 字节解析 16B header */
export function parseLegacyHeader(decompressed: Uint8Array): SpzHeaderInfo {
  if (decompressed.length < 16) {
    throw new Error('[spz-reader] legacy SPZ 文件过短: 不足 16 字节 header');
  }
  const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== SPZ_MAGIC) {
    throw new Error(`[spz-reader] legacy SPZ magic 校验失败: 0x${magic.toString(16)}`);
  }
  const version = view.getUint32(4, true);
  if (version < 1 || version > MIN_ZSTD_SPZ_HEADER_VERSION - 1) {
    throw new Error(`[spz-reader] 不支持的 SPZ 版本: ${version}`);
  }
  return {
    version,
    numPoints: view.getUint32(8, true),
    shDegree: view.getUint8(12),
    fractionalBits: view.getUint8(13),
    antialiased: (view.getUint8(14) & 0x1) !== 0,
    container: 'gzip',
  };
}

/** 解析 v4 NGSP 32B 明文 header + TOC 元数据 */
export function parseNgspHeader(data: Uint8Array): SpzHeaderInfo {
  if (data.length < 32) {
    throw new Error('[spz-reader] NGSP 文件过短: 不足 32 字节 header');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!isNgspMagic(data)) {
    throw new Error('[spz-reader] NGSP magic 校验失败');
  }
  const version = view.getUint32(4, true);
  if (version < MIN_ZSTD_SPZ_HEADER_VERSION) {
    throw new Error(`[spz-reader] NGSP header 版本异常: ${version}`);
  }
  return {
    version,
    numPoints: view.getUint32(8, true),
    shDegree: view.getUint8(12),
    fractionalBits: view.getUint8(13),
    antialiased: (view.getUint8(14) & 0x1) !== 0,
    container: 'ngsp',
    numStreams: view.getUint8(15),
    tocByteOffset: view.getUint32(16, true),
  };
}

/**
 * 从 SPZ 字节加载为 GaussianCloudSoA
 *
 * @param data SPZ 文件字节 (v1-v4)
 * @param options 读取选项 (v4 需要 zstdDecompress)
 * @returns GaussianCloudSoA (属性直接反量化, 与 spz-writer 的量化互为逆运算)
 */
export async function loadGaussiansFromSpzSoA(
  data: Uint8Array,
  options: SpzReadOptions = {},
): Promise<GaussianCloudSoA> {
  const source = options.source ?? 'spz';
  const zstd = options.zstdDecompress;

  let header: SpzHeaderInfo;
  let body: Uint8Array;
  let usesFloat16 = false;
  let usesSmallestThree = false;

  if (data.length >= 4 && isNgspMagic(data)) {
    if (!zstd) {
      throw new Error(
        '[spz-reader] SPZ v4 (NGSP+zstd) 需要 zstdDecompress 解压器 (见 C-11 zstd 依赖策略文档)',
      );
    }
    header = parseNgspHeader(data);
    usesSmallestThree = header.version >= MIN_SMALLEST_THREE_QUATERNIONS_VERSION;
    body = await decompressNgspStreams(data, header, zstd);
  } else if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    body = await gzipDecompress(data);
    header = parseLegacyHeader(body);
    usesFloat16 = header.version === 1;
    usesSmallestThree = header.version >= MIN_SMALLEST_THREE_QUATERNIONS_VERSION;
    // 跳过 16B legacy header, 剩余为属性体
    body = body.subarray(16);
  } else {
    throw new Error('[spz-reader] 无法识别的 SPZ 格式: 不是 gzip 也不是 NGSP');
  }

  return decodeLegacyBody(body, header, { source, usesFloat16, usesSmallestThree });
}

/** AoS 兼容入口 */
export async function loadGaussiansFromSpz(
  data: Uint8Array,
  options: SpzReadOptions = {},
): Promise<GaussianCloud> {
  return fromSoA(await loadGaussiansFromSpzSoA(data, options));
}

// ─── 属性体解码 ───────────────────────────────────────────

/** 按 legacy v1-v4 布局反量化属性体 (v4 解压后与 v2/v3 相同的流布局, 旋转除外) */
export function decodeLegacyBody(
  body: Uint8Array,
  header: {
    numPoints: number;
    shDegree: number;
    fractionalBits: number;
    version: number;
  },
  opts: { source?: string; usesFloat16?: boolean; usesSmallestThree?: boolean } = {},
): GaussianCloudSoA {
  const count = header.numPoints;
  const shDim = SH_DIM[header.shDegree] ?? 0;
  const totalShCoeffs = shDim * 3;
  const usesFloat16 = opts.usesFloat16 ?? header.version === 1;
  const usesSmallestThree = opts.usesSmallestThree ?? header.version >= 3;

  const posBytes = usesFloat16 ? 6 : 9;
  const rotBytes = usesSmallestThree ? 4 : 3;

  const positionsSize = count * posBytes;
  const alphasSize = count * 1;
  const colorsSize = count * 3;
  const scalesSize = count * 3;
  const rotationsSize = count * rotBytes;
  const shSize = count * totalShCoeffs;

  if (body.length < positionsSize + alphasSize + colorsSize + scalesSize + rotationsSize + shSize) {
    throw new Error(
      `[spz-reader] 属性体长度不足: 需要 ${positionsSize + alphasSize + colorsSize + scalesSize + rotationsSize + shSize} 字节, 实际 ${body.length}`,
    );
  }

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const sh = totalShCoeffs > 0 ? new Float32Array(count * totalShCoeffs) : undefined;

  const fraction = 1 << header.fractionalBits;

  // 1. Positions
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const base = offset + i * posBytes;
    const i3 = i * 3;
    if (usesFloat16) {
      positions[i3] = halfToFloat(view.getUint16(base, true));
      positions[i3 + 1] = halfToFloat(view.getUint16(base + 2, true));
      positions[i3 + 2] = halfToFloat(view.getUint16(base + 4, true));
    } else {
      positions[i3] = readInt24LE(view, base) / fraction;
      positions[i3 + 1] = readInt24LE(view, base + 3) / fraction;
      positions[i3 + 2] = readInt24LE(view, base + 6) / fraction;
    }
  }
  offset += positionsSize;

  // 2. Alphas
  for (let i = 0; i < count; i++) {
    opacities[i] = body[offset + i] / 255;
  }
  offset += alphasSize;

  // 3. Colors (DC 编码 → RGB, 与 spz-writer.scaleRgbToSpz 互逆)
  for (let i = 0; i < count; i++) {
    const base = offset + i * 3;
    const i3 = i * 3;
    colors[i3] = (body[base] / 255 - 0.5) * (SH_C0 / SPZ_COLOR_SCALE) + 0.5;
    colors[i3 + 1] = (body[base + 1] / 255 - 0.5) * (SH_C0 / SPZ_COLOR_SCALE) + 0.5;
    colors[i3 + 2] = (body[base + 2] / 255 - 0.5) * (SH_C0 / SPZ_COLOR_SCALE) + 0.5;
  }
  offset += colorsSize;

  // 4. Scales (log 编码 → 线性, 与 spz-writer.scaleToSpz 互逆)
  for (let i = 0; i < count; i++) {
    const base = offset + i * 3;
    const i3 = i * 3;
    scales[i3] = Math.exp(body[base] / 16 - 10);
    scales[i3 + 1] = Math.exp(body[base + 1] / 16 - 10);
    scales[i3 + 2] = Math.exp(body[base + 2] / 16 - 10);
  }
  offset += scalesSize;

  // 5. Rotations
  for (let i = 0; i < count; i++) {
    const base = offset + i * rotBytes;
    const i4 = i * 4;
    if (usesSmallestThree) {
      unpackQuaternionSmallestThree(body, base, rotations, i4);
    } else {
      unpackQuaternionFirstThree(body, base, rotations, i4);
    }
  }
  offset += rotationsSize;

  // 6. SH ((byte - 128) / 128, 与 spz-writer.quantizeSh 逆运算简化版)
  if (sh && totalShCoeffs > 0) {
    for (let i = 0; i < count * totalShCoeffs; i++) {
      sh[i] = (body[offset + i] - 128) / 128;
    }
  }

  return {
    count,
    shDegree: header.shDegree,
    source: opts.source ?? 'spz',
    positions,
    scales,
    rotations,
    colors,
    opacities,
    sh,
  };
}

// ─── v4 NGSP 流解压 ───────────────────────────────────────

/** TOC 顺序: 与 Niantic kAllSplatAttributes 一致 (空的 SH 流被省略) */
const NGSP_ATTR_ORDER = ['positions', 'alphas', 'colors', 'scales', 'rotations', 'sh'] as const;

/** 按 TOC 解压全部 zstd 流并拼接为 legacy 布局单 buffer */
async function decompressNgspStreams(
  data: Uint8Array,
  header: SpzHeaderInfo,
  zstd: ZstdDecompressFn,
): Promise<Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numStreams = header.numStreams ?? 0;
  const toc = header.tocByteOffset ?? 0;

  if (toc < 32 || toc + numStreams * 16 > data.length) {
    throw new Error('[spz-reader] NGSP TOC 越界');
  }

  const shDim = SH_DIM[header.shDegree] ?? 0;
  const usesSmallestThree = header.version >= MIN_SMALLEST_THREE_QUATERNIONS_VERSION;
  const rotBytes = usesSmallestThree ? 4 : 3;
  const posBytes = 9; // v4 无 float16

  // 期望属性体尺寸 (legacy 拼接布局)
  const sizes: Record<string, number> = {
    positions: header.numPoints * posBytes,
    alphas: header.numPoints,
    colors: header.numPoints * 3,
    scales: header.numPoints * 3,
    rotations: header.numPoints * rotBytes,
    sh: header.numPoints * shDim * 3,
  };

  // 解析 TOC: 每个 entry [compressedSize u64, uncompressedSize u64]
  const entries: Array<{ compressedSize: number; uncompressedSize: number }> = [];
  for (let s = 0; s < numStreams; s++) {
    const e = toc + s * 16;
    // 用 Number 处理 u64 (实际文件远小于 2^53)
    const compressedSize = Number(view.getBigUint64(e, true));
    const uncompressedSize = Number(view.getBigUint64(e + 8, true));
    entries.push({ compressedSize, uncompressedSize });
  }

  // 按 expected 顺序分配压缩块 (跳过尺寸为 0 的流, 与官方 compressNgspStreams 一致)
  const streams: Record<string, { compressed: Uint8Array; uncompressedSize: number }> = {};
  let cursor = toc + numStreams * 16;
  let entryIndex = 0;
  for (const attr of NGSP_ATTR_ORDER) {
    const expected = sizes[attr];
    if (expected === 0) continue;
    if (entryIndex >= entries.length) {
      throw new Error(`[spz-reader] NGSP 流数量不足: 缺少 ${attr}`);
    }
    const entry = entries[entryIndex++];
    if (entry.compressedSize > data.length - cursor) {
      throw new Error(`[spz-reader] NGSP 流 ${attr} 越界`);
    }
    streams[attr] = {
      compressed: data.subarray(cursor, cursor + entry.compressedSize),
      uncompressedSize: entry.uncompressedSize,
    };
    cursor += entry.compressedSize;
  }
  if (entryIndex !== entries.length) {
    throw new Error('[spz-reader] NGSP TOC 与属性流数量不匹配');
  }

  // 逐流解压到拼接 buffer
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const out = new Uint8Array(total);
  let outOffset = 0;
  for (const attr of NGSP_ATTR_ORDER) {
    const expected = sizes[attr];
    if (expected === 0) continue;
    const stream = streams[attr];
    if (stream.uncompressedSize !== expected) {
      throw new Error(
        `[spz-reader] NGSP 流 ${attr} 解压尺寸不匹配: 期望 ${expected}, TOC ${stream.uncompressedSize}`,
      );
    }
    const chunk = await zstd(stream.compressed, stream.uncompressedSize);
    if (chunk.length !== stream.uncompressedSize) {
      throw new Error(
        `[spz-reader] NGSP 流 ${attr} 解压器返回长度不符: 期望 ${stream.uncompressedSize}, 实际 ${chunk.length}`,
      );
    }
    out.set(chunk, outOffset);
    outOffset += expected;
  }

  return out;
}

// ─── 解码辅助 ─────────────────────────────────────────────

/** 24-bit signed little-endian 读取 (符号扩展) */
function readInt24LE(view: DataView, offset: number): number {
  let v = view.getUint8(offset);
  v |= view.getUint8(offset + 1) << 8;
  v |= view.getUint8(offset + 2) << 16;
  return v & 0x800000 ? v | 0xff000000 : v;
}

/** IEEE 754 half → float (Node <22 无 DataView.getFloat16, 手写) */
function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/**
 * 解码 v2 旋转 (xyz 8-bit signed, w = sqrt(1 - x²-y²-z²))
 * [来源: Niantic unpackQuaternionFirstThree — splat-utils.h]
 */
function unpackQuaternionFirstThree(
  bytes: Uint8Array,
  offset: number,
  out: Float32Array,
  outOffset: number,
): void {
  const x = bytes[offset] / 127.5 - 1;
  const y = bytes[offset + 1] / 127.5 - 1;
  const z = bytes[offset + 2] / 127.5 - 1;
  out[outOffset] = x;
  out[outOffset + 1] = y;
  out[outOffset + 2] = z;
  out[outOffset + 3] = Math.sqrt(Math.max(0, 1 - (x * x + y * y + z * z)));
}

/**
 * 解码 v3+ 旋转 (smallest-three: 2bit 最大分量索引 + 3 × 10bit 符号+9bit 幅度)
 * [来源: Niantic unpackQuaternionSmallestThree — splat-utils.h]
 */
function unpackQuaternionSmallestThree(
  bytes: Uint8Array,
  offset: number,
  out: Float32Array,
  outOffset: number,
): void {
  const comp =
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);
  const iLargest = (comp >>> 30) & 0x3;
  let c = comp;
  let sumSquares = 0;
  // 降序读取低位块, 与包写对称: 打包端升序循环 comp=(comp<<10)|x,
  // 使最高索引分量落在最低 10 位, 故解码须从高索引向低索引读
  for (let i = 3; i >= 0; i--) {
    if (i !== iLargest) {
      const mag = c & 0x1ff;
      const negbit = (c >> 9) & 0x1;
      c = c >>> 10;
      const v = ((SQRT1_2 * mag) / 0x1ff) * (negbit ? -1 : 1);
      out[outOffset + i] = v;
      sumSquares += v * v;
    }
  }
  out[outOffset + iLargest] = Math.sqrt(Math.max(0, 1 - sumSquares));
}

/** gzip 整体解压 (Web Compression API, Node 18+/浏览器通用) */
async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  // 复制到 ArrayBuffer-backed Uint8Array, 避免 SharedArrayBuffer 类型冲突 (Blob 仅接受 ArrayBuffer)
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** 判断 NGSP magic ("NGSP" LE = 0x5053474e) */
function isNgspMagic(data: Uint8Array): boolean {
  return data[0] === 0x4e && data[1] === 0x47 && data[2] === 0x53 && data[3] === 0x50;
}
