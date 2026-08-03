/**
 * SPZ 格式写入器 — Niantic Labs SPZ v2 格式
 *
 * Header (16 bytes):
 *   magic          Uint32 LE  = 0x50474853 (1347635022)
 *   version        Uint32 LE  = 2
 *   numPoints      Uint32 LE
 *   shDegree       Uint8
 *   fractionalBits Uint8      (default 12)
 *   flags          Uint8      (bit 0 = antialiased)
 *   reserved       Uint8      = 0
 *
 * Body (gzip compressed, separate attribute streams):
 *   1. Positions   N × 9 bytes  (3 × 24-bit signed int LE, quantized by 1<<fractionalBits)
 *   2. Alphas      N × 1 byte   (uint8, alpha * 255)
 *   3. Colors      N × 3 bytes  (uint8 × 3, DC color encoded)
 *   4. Scales      N × 3 bytes  (uint8 × 3, log-scale encoded)
 *   5. Rotations   N × 3 bytes  (uint8 × 3, xyz stored; w = sqrt(1-x²-y²-z²))
 *   6. SH          N × shDim×3 bytes (uint8, quantized)
 *
 * [来源: Spark 源码 — SpzWriter class, node_modules/@sparkjsdev/spark/dist/spark.module.js:16894]
 * [来源: SPZ 格式 — github.com/nianticlabs/spz]
 * [来源: Spark 源码 — SpzReader.parseSplats, node_modules/@sparkjsdev/spark/dist/spark.module.js:16734]
 */

import type { GaussianCloud } from './gaussian-loader.js';
import { SH_C0 } from './gaussian-loader.js';

/** SPZ 魔数 = 0x50474853 ("SGHP" LE) */
export const SPZ_MAGIC = 1347635022;

/** SPZ 版本 (v2: 3字节旋转, 广泛兼容) */
export const SPZ_VERSION = 2;

/** 抗锯齿标志位 */
export const SPZ_FLAG_ANTIALIASED = 1;

/** SH C0 常数 */
// SH_C0 already imported

/** SPZ 颜色缩放常数 */
const SPZ_COLOR_SCALE = 0.15;

/** SH degree → 每通道系数数 */
const SH_DIM: Record<number, number> = { 0: 0, 1: 3, 2: 8, 3: 15 };

/** SPZ 写入选项 */
export interface SpzWriterOptions {
  /** SH 阶数 (0-3), 默认使用 cloud.shDegree */
  shDegree?: number;
  /** 位置量化小数位 (默认 12) */
  fractionalBits?: number;
  /** 是否标记为抗锯齿 (默认 true) */
  flagAntiAlias?: boolean;
}

/**
 * 将 GaussianCloud 写入 SPZ v2 格式
 *
 * 返回 gzip 压缩后的 Uint8Array, 可直接写入 .spz 文件
 *
 * @param cloud 高斯核集合
 * @param options 写入选项
 * @returns gzip 压缩的 Uint8Array
 */
export async function writeSpz(
  cloud: GaussianCloud,
  options: SpzWriterOptions = {},
): Promise<Uint8Array> {
  const {
    shDegree = cloud.shDegree,
    fractionalBits = 12,
    flagAntiAlias = true,
  } = options;

  const numSplats = cloud.splats.length;
  const shDim = SH_DIM[shDegree] ?? 0;

  // 计算各属性流大小
  const positionsSize = numSplats * 9;   // 3 × 3 bytes (24-bit)
  const alphasSize = numSplats * 1;
  const colorsSize = numSplats * 3;
  const scalesSize = numSplats * 3;
  const rotationsSize = numSplats * 3;   // v2: 3 bytes (xyz only)
  const shSize = numSplats * shDim * 3;

  const headerSize = 16;
  const bodySize = positionsSize + alphasSize + colorsSize +
                   scalesSize + rotationsSize + shSize;
  const totalSize = headerSize + bodySize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // ── Header (16 bytes) ──
  view.setUint32(0, SPZ_MAGIC, true);
  view.setUint32(4, SPZ_VERSION, true);
  view.setUint32(8, numSplats, true);
  view.setUint8(12, shDegree);
  view.setUint8(13, fractionalBits);
  view.setUint8(14, flagAntiAlias ? SPZ_FLAG_ANTIALIASED : 0);
  view.setUint8(15, 0); // reserved

  const fraction = 1 << fractionalBits;

  // ── 1. Positions (N × 9 bytes, 24-bit signed int LE) ──
  let offset = headerSize;
  for (let i = 0; i < numSplats; i++) {
    const s = cloud.splats[i];
    writeInt24LE(view, offset, quantizePosition(s.x, fraction));
    writeInt24LE(view, offset + 3, quantizePosition(s.y, fraction));
    writeInt24LE(view, offset + 6, quantizePosition(s.z, fraction));
    offset += 9;
  }

  // ── 2. Alphas (N × 1 byte) ──
  for (let i = 0; i < numSplats; i++) {
    const s = cloud.splats[i];
    view.setUint8(offset + i, clampU8(Math.round(s.opacity * 255)));
  }
  offset += alphasSize;

  // ── 3. Colors (N × 3 bytes, DC color encoded) ──
  for (let i = 0; i < numSplats; i++) {
    const s = cloud.splats[i];
    const base = offset + i * 3;
    view.setUint8(base + 0, scaleRgbToSpz(s.colorR));
    view.setUint8(base + 1, scaleRgbToSpz(s.colorG));
    view.setUint8(base + 2, scaleRgbToSpz(s.colorB));
  }
  offset += colorsSize;

  // ── 4. Scales (N × 3 bytes, log-scale encoded) ──
  for (let i = 0; i < numSplats; i++) {
    const s = cloud.splats[i];
    const base = offset + i * 3;
    view.setUint8(base + 0, scaleToSpz(s.scaleX));
    view.setUint8(base + 1, scaleToSpz(s.scaleY));
    view.setUint8(base + 2, scaleToSpz(s.scaleZ));
  }
  offset += scalesSize;

  // ── 5. Rotations (N × 3 bytes, v2: xyz only) ──
  for (let i = 0; i < numSplats; i++) {
    const s = cloud.splats[i];
    const base = offset + i * 3;
    // Normalize quaternion and ensure w >= 0
    const { x, y, z } = normalizeQuatForSpzV2(s.rotW, s.rotX, s.rotY, s.rotZ);
    // Encode: value = round((component + 1) * 127.5)
    view.setUint8(base + 0, clampU8(Math.round((x + 1) * 127.5)));
    view.setUint8(base + 1, clampU8(Math.round((y + 1) * 127.5)));
    view.setUint8(base + 2, clampU8(Math.round((z + 1) * 127.5)));
  }
  offset += rotationsSize;

  // ── 6. SH (N × shDim × 3 bytes) ──
  if (shDim > 0) {
    for (let i = 0; i < numSplats; i++) {
      const s = cloud.splats[i];
      const sh = s.sh;
      const base = offset + i * shDim * 3;
      if (sh) {
        for (let j = 0; j < shDim * 3 && j < sh.length; j++) {
          // Determine bits: degree 1 uses 5 bits, degree 2+ uses 4 bits
          const bits = j < 9 ? 5 : 4;
          view.setUint8(base + j, quantizeSh(sh[j], bits));
        }
      } else {
        // No SH data, fill with 128 (neutral)
        for (let j = 0; j < shDim * 3; j++) {
          view.setUint8(base + j, 128);
        }
      }
    }
  }

  // ── Gzip compress entire buffer ──
  return gzipCompress(u8);
}

/** 位置量化: round(x * fraction), clamped to ±8388607 (24-bit signed) */
function quantizePosition(value: number, fraction: number): number {
  return Math.max(-8388607, Math.min(8388607, Math.round(value * fraction)));
}

/** 写入 24-bit 有符号整数 (little-endian) */
function writeInt24LE(view: DataView, offset: number, value: number): void {
  view.setUint8(offset, value & 0xff);
  view.setUint8(offset + 1, (value >> 8) & 0xff);
  view.setUint8(offset + 2, (value >> 16) & 0xff);
}

/**
 * SPZ 颜色编码: ((r - 0.5) / (SH_C0 / 0.15) + 0.5) * 255
 * [来源: Spark SpzWriter.scaleRgb — spark.module.js:16954]
 */
function scaleRgbToSpz(r: number): number {
  const v = ((r - 0.5) / (SH_C0 / SPZ_COLOR_SCALE) + 0.5) * 255;
  return clampU8(Math.round(v));
}

/**
 * SPZ 缩放编码: round((log(scale) + 10) * 16), clamped 0-255
 * [来源: Spark SpzWriter.setScale — spark.module.js:16964]
 */
function scaleToSpz(scale: number): number {
  const v = Math.round((Math.log(Math.max(scale, 1e-10)) + 10) * 16);
  return clampU8(v);
}

/**
 * 归一化四元数并确保 w >= 0 (v2 要求 w = sqrt(...))
 */
function normalizeQuatForSpzV2(
  w: number, x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  const len = Math.sqrt(w * w + x * x + y * y + z * z);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  let nw = w / len;
  let nx = x / len;
  let ny = y / len;
  let nz = z / len;
  // Ensure w >= 0 (since reader computes w = sqrt(...))
  if (nw < 0) {
    nw = -nw; nx = -nx; ny = -ny; nz = -nz;
  }
  return { x: nx, y: ny, z: nz };
}

/**
 * SH 量化: round(sh * 128) + 128, then bucket quantize to `bits` bits
 * [来源: Spark SpzWriter.quantizeSh — spark.module.js:17004]
 */
function quantizeSh(sh: number, bits: number): number {
  const value = Math.round(sh * 128) + 128;
  const bucketSize = 1 << (8 - bits);
  const quantized = Math.floor((value + bucketSize / 2) / bucketSize) * bucketSize;
  return clampU8(quantized);
}

/** Clamp to 0-255 */
function clampU8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Gzip 压缩 (使用 Web Compression API)
 * 在 Node.js 18+ 中可用, 浏览器中也可用
 */
async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const compressed = stream.pipeThrough(new CompressionStream('gzip'));
  const response = new Response(compressed);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
