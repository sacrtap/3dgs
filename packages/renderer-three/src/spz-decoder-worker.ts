/**
 * SPZ Worker 解码器 — 将 SPZ 解码移到 Web Worker, 避免阻塞主线程
 *
 * ★ P1-4: SPZ Worker 解码
 *
 * 工作流程:
 *   1. 主线程 fetch 获取 SPZ 文件 (gzip 压缩)
 *   2. 将 SPZ 数据 transfer 到 Worker
 *   3. Worker 中: gzip 解压 → 反量化 → 输出 .splat 格式字节 (32B/splat)
 *   4. .splat 字节 transfer 回主线程
 *   5. 主线程创建 SplatMesh({ fileBytes, fileType: SPLAT })
 *
 * 优势:
 *   ✅ 主线程不阻塞 — gzip 解压 + 反量化在 Worker 中执行
 *   ✅ 支持 maxSplats 截断 — 解码后可均匀降采样
 *   ✅ 进度回调 — fetch 阶段可报告下载进度
 *   ✅ 格式统一 — 解码为 .splat 格式后与 .splat 加载路径一致
 *
 * SPZ 格式 (Niantic SPZ v2):
 *   Header (16 bytes, 未压缩):
 *     magic          Uint32 LE  = 0x50474853
 *     version        Uint32 LE  = 2
 *     numPoints      Uint32 LE
 *     shDegree       Uint8
 *     fractionalBits Uint8      (default 12)
 *     flags          Uint8      (bit 0 = antialiased)
 *     reserved       Uint8      = 0
 *
 *   Body (gzip 压缩, 分离属性流):
 *     1. Positions   N × 9 bytes  (3 × 24-bit signed int LE, quantized by 1<<fractionalBits)
 *     2. Alphas      N × 1 byte   (uint8, alpha * 255)
 *     3. Colors      N × 3 bytes  (uint8 × 3, DC color encoded)
 *     4. Scales      N × 3 bytes  (uint8 × 3, log-scale encoded)
 *     5. Rotations   N × 3 bytes  (uint8 × 3, xyz stored; w = sqrt(1-x²-y²-z²))
 *     6. SH          N × shDim×3 bytes (uint8, quantized) — 解码为 .splat 时跳过
 *
 * .splat 格式 (32 bytes/splat):
 *     Position XYZ  3 × Float32  (12 bytes)
 *     Scale XYZ     3 × Float32  (12 bytes)
 *     Color RGBA    4 × Uint8    (4 bytes)
 *     Rotation IJKL 4 × Uint8    (4 bytes)
 *
 * [来源: SPZ 格式 — github.com/nianticlabs/spz]
 * [来源: 项目源码 — packages/convert/src/spz-writer.ts]
 * [来源: 项目源码 — packages/convert/src/splat-writer.ts]
 * [来源: DecompressionStream — developer.mozilla.org/en-US/docs/Web/API/DecompressionStream]
 */

/** SPZ 魔数 = 0x5053474E ("NGSP" LE, Niantic SPZ 官方魔数) */
export const SPZ_MAGIC = 1347635022;

/** SPZ 版本 */
export const SPZ_VERSION = 2;

/** SH C0 常数 (球谐函数第 0 阶) */
const SH_C0 = 0.28209479177387814;

/** SPZ 颜色缩放常数 */
const SPZ_COLOR_SCALE = 0.15;

/** SH_C0 / SPZ_COLOR_SCALE — 颜色反量化缩放因子 */
const COLOR_SCALE = SH_C0 / SPZ_COLOR_SCALE; // ≈ 1.8806

/** .splat 每高斯核字节数 */
const SPLAT_BYTES_PER_SPLAT = 32;

/** SPZ header 大小 */
const SPZ_HEADER_SIZE = 16;

/** SPZ header 解析结果 */
export interface SpzHeader {
  magic: number;
  version: number;
  numSplats: number;
  shDegree: number;
  fractionalBits: number;
  flags: number;
}

/**
 * 解析 SPZ header (16 bytes)
 *
 * [来源: 项目源码 — packages/convert/src/spz-writer.ts:96-103]
 */
export function parseSpzHeader(data: ArrayBuffer | Uint8Array): SpzHeader {
  const view = new DataView(data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
  return {
    magic: view.getUint32(0, true),
    version: view.getUint32(4, true),
    numSplats: view.getUint32(8, true),
    shDegree: view.getUint8(12),
    fractionalBits: view.getUint8(13),
    flags: view.getUint8(14),
  };
}

/**
 * 验证 SPZ header
 *
 * ★ C3: 增加numSplats范围检查, 防止OOM崩溃
 */
export function validateSpzHeader(header: SpzHeader): void {
  if (header.magic !== SPZ_MAGIC) {
    throw new Error(`无效的 SPZ 文件: magic 不匹配 (0x${header.magic.toString(16)})`);
  }
  if (header.version !== SPZ_VERSION) {
    throw new Error(`不支持的 SPZ 版本: ${header.version} (仅支持 v${SPZ_VERSION})`);
  }
  // ★ C3: numSplats 合理性检查 — 防止恶意/损坏文件导致 OOM
  //   注意: numSplats=0 是合法的空文件, 不报错 (返回空 buffer)
  if (header.numSplats > 100_000_000) {
    throw new Error(`SPZ numSplats 过大: ${header.numSplats.toLocaleString()} (上限 100M), 可能导致 OOM`);
  }
}

// ─── 纯解码函数 (可在主线程或 Worker 中执行) ─────────────────

/**
 * 将 SPZ 格式解码为 .splat 格式
 *
 * 输入: SPZ 文件的完整 ArrayBuffer
 * 输出: .splat 格式的 Uint8Array (32 bytes/splat)
 *
 * 支持两种布局 (自动检测):
 *   A. 权威布局 (Spark/Niantic): 整文件 = 单个 gzip 流, 解压后 = header + body
 *   B. 旧版布局 (本项目 M5 时期): 16B 未压缩 header + gzip body (向后兼容)
 *
 * 解码步骤:
 *   1. 检测布局并解压得到 [header + body]
 *   2. 解析 SPZ header (16 bytes)
 *   3. 反量化各属性流 → .splat 格式
 *
 * 注意: .splat 格式不支持 SH 球谐系数, SH 数据被跳过。
 *       如需 SH, 请使用 Spark 的 URL 直接加载 (new SplatMesh({ url: ... }))。
 *
 * [来源: SPZ 反量化公式 — packages/convert/src/spz-writer.ts 编码逻辑的逆运算]
 */
export async function decodeSpz(data: ArrayBuffer): Promise<Uint8Array> {
  // 1. 检测布局并解压 → [header + body]
  const full = await spzDecompressWhole(new Uint8Array(data));

  // 2. 解析 header
  const header = parseSpzHeader(full);
  validateSpzHeader(header);

  const { numSplats, fractionalBits } = header;
  const fraction = 1 << fractionalBits;

  const decompressed = full.subarray(SPZ_HEADER_SIZE);

  // 3. 计算各属性流偏移
  // SH 数据被跳过 (.splat 格式不支持 SH), shDim 仅用于文档说明
  // const shDim = SH_DIM[shDegree] ?? 0;
  const positionsSize = numSplats * 9;
  const alphasSize = numSplats * 1;
  const colorsSize = numSplats * 3;
  const scalesSize = numSplats * 3;

  const positionsOffset = 0;
  const alphasOffset = positionsOffset + positionsSize;
  const colorsOffset = alphasOffset + alphasSize;
  const scalesOffset = colorsOffset + colorsSize;
  const rotationsOffset = scalesOffset + scalesSize;
  // SH 数据在 rotations 之后, 解码为 .splat 时跳过

  // 4. 反量化 → .splat 格式
  const splatData = new Uint8Array(numSplats * SPLAT_BYTES_PER_SPLAT);
  const splatView = new DataView(splatData.buffer);
  const splatF32 = new Float32Array(splatData.buffer);

  for (let i = 0; i < numSplats; i++) {
    const dstBase = i * SPLAT_BYTES_PER_SPLAT;
    const dstF32Base = i * 8; // 32 bytes = 8 × Float32

    // ── Position (24-bit signed int → Float32) ──
    const px = readInt24LE(decompressed, positionsOffset + i * 9) / fraction;
    const py = readInt24LE(decompressed, positionsOffset + i * 9 + 3) / fraction;
    const pz = readInt24LE(decompressed, positionsOffset + i * 9 + 6) / fraction;
    splatF32[dstF32Base + 0] = px;
    splatF32[dstF32Base + 1] = py;
    splatF32[dstF32Base + 2] = pz;

    // ── Scale (log-scale encoded → Float32) ──
    // 编码: round((log(scale) + 10) * 16)
    // 解码: scale = exp((byte / 16) - 10)
    const sx = Math.exp((decompressed[scalesOffset + i * 3] / 16) - 10);
    const sy = Math.exp((decompressed[scalesOffset + i * 3 + 1] / 16) - 10);
    const sz = Math.exp((decompressed[scalesOffset + i * 3 + 2] / 16) - 10);
    splatF32[dstF32Base + 3] = sx;
    splatF32[dstF32Base + 4] = sy;
    splatF32[dstF32Base + 5] = sz;

    // ── Color RGBA (4 × Uint8) at byte offset 24 ──
    // SPZ 颜色编码: ((r - 0.5) / (SH_C0 / 0.15) + 0.5) * 255
    // SPZ 颜色解码: r = (byte / 255 - 0.5) * (SH_C0 / 0.15) + 0.5
    // .splat 颜色编码: round(r * 255)
    const spzR = decompressed[colorsOffset + i * 3];
    const spzG = decompressed[colorsOffset + i * 3 + 1];
    const spzB = decompressed[colorsOffset + i * 3 + 2];
    const colorR = (spzR / 255 - 0.5) * COLOR_SCALE + 0.5;
    const colorG = (spzG / 255 - 0.5) * COLOR_SCALE + 0.5;
    const colorB = (spzB / 255 - 0.5) * COLOR_SCALE + 0.5;

    // Alpha — SPZ 和 .splat 格式相同 (byte = round(opacity * 255))
    const alpha = decompressed[alphasOffset + i];

    const colorByteOffset = dstBase + 24;
    splatView.setUint8(colorByteOffset + 0, clampU8(colorR * 255));
    splatView.setUint8(colorByteOffset + 1, clampU8(colorG * 255));
    splatView.setUint8(colorByteOffset + 2, clampU8(colorB * 255));
    splatView.setUint8(colorByteOffset + 3, alpha);

    // ── Rotation IJKL (4 × Uint8) at byte offset 28 ──
    // SPZ 旋转编码: value = round((component + 1) * 127.5), xyz only, w = sqrt(...)
    // SPZ 旋转解码: component = byte / 127.5 - 1
    // .splat 旋转编码: value = round(component * 128) + 128
    const rx = decompressed[rotationsOffset + i * 3] / 127.5 - 1;
    const ry = decompressed[rotationsOffset + i * 3 + 1] / 127.5 - 1;
    const rz = decompressed[rotationsOffset + i * 3 + 2] / 127.5 - 1;
    const rw = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry - rz * rz));

    const rotByteOffset = dstBase + 28;
    splatView.setUint8(rotByteOffset + 0, clampU8(Math.round(rw * 128) + 128));
    splatView.setUint8(rotByteOffset + 1, clampU8(Math.round(rx * 128) + 128));
    splatView.setUint8(rotByteOffset + 2, clampU8(Math.round(ry * 128) + 128));
    splatView.setUint8(rotByteOffset + 3, clampU8(Math.round(rz * 128) + 128));
  }

  return splatData;
}

// ─── Worker 解码 ────────────────────────────────────────────

/**
 * 在 Web Worker 中解码 SPZ 文件
 *
 * 使用方式:
 *   const response = await fetch(url);
 *   const spzData = await response.arrayBuffer();
 *   const splatBytes = await decodeSpzInWorker(spzData);
 *   // splatBytes 为 .splat 格式, 可直接传入 SplatMesh({ fileBytes })
 *
 * 如果 Worker 不可用 (如非浏览器环境), 回退到主线程解码。
 *
 * @param data SPZ 文件的 ArrayBuffer (含 header + gzip body)
 * @returns .splat 格式的 Uint8Array (32 bytes/splat)
 */
export async function decodeSpzInWorker(data: ArrayBuffer): Promise<Uint8Array> {
  // Worker 不可用时回退到主线程
  if (typeof Worker === 'undefined') {
    return decodeSpz(data);
  }

  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(URL.createObjectURL(new Blob([WORKER_CODE], { type: 'application/javascript' })));

      worker.onmessage = (e: MessageEvent) => {
        worker.terminate();
        if (e.data.error) {
          reject(new Error(e.data.error));
        } else {
          resolve(new Uint8Array(e.data.buffer));
        }
      };

      worker.onerror = () => {
        worker.terminate();
        // Worker 失败, 回退到主线程
        decodeSpz(data).then(resolve, reject);
      };

      // Transfer SPZ 数据到 Worker (零拷贝)
      worker.postMessage({ buffer: data }, [data]);
    } catch {
      // Worker 创建失败, 回退到主线程
      decodeSpz(data).then(resolve, reject);
    }
  });
}

// ─── 内部工具函数 ───────────────────────────────────────────

/**
 * gzip 解压 (使用浏览器原生 DecompressionStream)
 *
 * [来源: DecompressionStream — developer.mozilla.org/en-US/docs/Web/API/DecompressionStream]
 */
async function gzipDecompress(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream 不可用, 无法解压 gzip 压缩的 SPZ 文件');
  }

  const ds = new DecompressionStream('gzip');
  const stream = new Blob([compressed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
  const decompressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressed);
}

/**
 * ★ 布局检测 + 解压 → 返回 [header(16B) + body] 完整流。
 *
 * - 文件以 gzip magic (1F 8B) 开头 → 权威布局: 整文件解压即可;
 * - 否则 → 旧版布局: 前 16B 为未压缩 header, 其余为 gzip body, 拼接返回。
 */
async function spzDecompressWhole(fileBytes: Uint8Array): Promise<Uint8Array> {
  if (fileBytes.length >= 2 && fileBytes[0] === 0x1f && fileBytes[1] === 0x8b) {
    return gzipDecompress(fileBytes);
  }
  // 旧版布局兼容: 先解析并校验未压缩 header (无效文件尽早报错), 再解压 body 拼接
  const legacyHeader = parseSpzHeader(fileBytes);
  validateSpzHeader(legacyHeader);
  const header = fileBytes.subarray(0, SPZ_HEADER_SIZE);
  const body = await gzipDecompress(fileBytes.subarray(SPZ_HEADER_SIZE));
  const merged = new Uint8Array(SPZ_HEADER_SIZE + body.length);
  merged.set(header, 0);
  merged.set(body, SPZ_HEADER_SIZE);
  return merged;
}

/**
 * ★ 读取 SPZ header (异步, 自动处理两种布局)。
 *
 * 供仅需元信息 (如日志打印 numSplats/shDegree) 的调用方使用,
 * 避免为取 16 字节头解码整个文件之外的额外工作。
 */
export async function readSpzHeader(data: ArrayBuffer | Uint8Array): Promise<SpzHeader> {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const whole = await spzDecompressWhole(u8);
  const header = parseSpzHeader(whole);
  validateSpzHeader(header);
  return header;
}

/**
 * 读取 24-bit 有符号整数 (little-endian)
 *
 * [来源: packages/convert/src/spz-writer.ts:188-192 writeInt24LE 的逆运算]
 */
function readInt24LE(u8: Uint8Array, offset: number): number {
  const lo = u8[offset];
  const mid = u8[offset + 1];
  const hi = u8[offset + 2];
  // 组合为 24-bit 无符号值
  let val = lo | (mid << 8) | (hi << 16);
  // 符号扩展: bit 23 为符号位
  if (val & 0x800000) val -= 0x1000000;
  return val;
}

/** Clamp 到 0-255 并取整 */
function clampU8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// ─── Worker 代码 (内联, 自包含, 无外部依赖) ──────────────────

/**
 * Worker 内执行的代码字符串
 *
 * 接收: { buffer: ArrayBuffer } — SPZ 文件数据
 * 返回: { buffer: ArrayBuffer } — .splat 格式数据
 *
 * Worker 代码必须自包含 (无 import), 所有依赖内联。
 */
const WORKER_CODE = `
"use strict";

// ── 常量 (与主线程同步) ──
var SPZ_MAGIC = 1347635022;
var SPZ_VERSION = 2;
var SH_C0 = 0.28209479177387814;
var SPZ_COLOR_SCALE = 0.15;
var COLOR_SCALE = SH_C0 / SPZ_COLOR_SCALE;
var SPLAT_BYTES_PER_SPLAT = 32;
var SPZ_HEADER_SIZE = 16;
var SH_DIM = { 0: 0, 1: 3, 2: 8, 3: 15 };

function clampU8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function readInt24LE(u8, offset) {
  var lo = u8[offset];
  var mid = u8[offset + 1];
  var hi = u8[offset + 2];
  var val = lo | (mid << 8) | (hi << 16);
  if (val & 0x800000) val -= 0x1000000;
  return val;
}

async function gzipDecompress(compressed) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream 不可用');
  }
  var ds = new DecompressionStream('gzip');
  var stream = new Blob([compressed]).stream().pipeThrough(ds);
  var decompressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressed);
}

async function decodeSpz(data) {
  // 1. 布局检测 + 解压 → [header + body]
  //    权威布局: 整文件单个 gzip 流; 旧版布局: 16B 未压缩 header + gzip body
  var u8 = new Uint8Array(data);
  var full;
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    full = await gzipDecompress(u8);
  } else {
    // 旧版布局: 先校验未压缩 header (无效文件尽早报错), 再解压 body 拼接
    var legacyView = new DataView(data);
    var legacyMagic = legacyView.getUint32(0, true);
    if (legacyMagic !== SPZ_MAGIC) {
      throw new Error('无效的 SPZ 文件: magic 不匹配 (0x' + legacyMagic.toString(16) + ')');
    }
    var legacyVersion = legacyView.getUint32(4, true);
    if (legacyVersion !== SPZ_VERSION) {
      throw new Error('不支持的 SPZ 版本: ' + legacyVersion);
    }
    var headerBytes = u8.subarray(0, SPZ_HEADER_SIZE);
    var bodyBytes = await gzipDecompress(u8.subarray(SPZ_HEADER_SIZE));
    full = new Uint8Array(SPZ_HEADER_SIZE + bodyBytes.length);
    full.set(headerBytes, 0);
    full.set(bodyBytes, SPZ_HEADER_SIZE);
  }

  // 2. 解析 header (位于解压流开头 16 字节)
  var view = new DataView(full.buffer, full.byteOffset, full.byteLength);
  var magic = view.getUint32(0, true);
  if (magic !== SPZ_MAGIC) {
    throw new Error('无效的 SPZ 文件: magic 不匹配 (0x' + magic.toString(16) + ')');
  }
  var version = view.getUint32(4, true);
  if (version !== SPZ_VERSION) {
    throw new Error('不支持的 SPZ 版本: ' + version);
  }
  var numSplats = view.getUint32(8, true);
  var shDegree = view.getUint8(12);
  var fractionalBits = view.getUint8(13);
  var fraction = 1 << fractionalBits;

  var decompressed = full.subarray(SPZ_HEADER_SIZE);

  // 3. 计算各属性流偏移
  var shDim = SH_DIM[shDegree] || 0;
  var positionsSize = numSplats * 9;
  var alphasSize = numSplats;
  var colorsSize = numSplats * 3;
  var scalesSize = numSplats * 3;
  var rotationsSize = numSplats * 3;

  var positionsOffset = 0;
  var alphasOffset = positionsOffset + positionsSize;
  var colorsOffset = alphasOffset + alphasSize;
  var scalesOffset = colorsOffset + colorsSize;
  var rotationsOffset = scalesOffset + scalesSize;

  // 4. 反量化 → .splat 格式
  var splatData = new Uint8Array(numSplats * SPLAT_BYTES_PER_SPLAT);
  var splatView = new DataView(splatData.buffer);
  var splatF32 = new Float32Array(splatData.buffer);

  for (var i = 0; i < numSplats; i++) {
    var dstBase = i * SPLAT_BYTES_PER_SPLAT;
    var dstF32Base = i * 8;

    // Position
    splatF32[dstF32Base + 0] = readInt24LE(decompressed, positionsOffset + i * 9) / fraction;
    splatF32[dstF32Base + 1] = readInt24LE(decompressed, positionsOffset + i * 9 + 3) / fraction;
    splatF32[dstF32Base + 2] = readInt24LE(decompressed, positionsOffset + i * 9 + 6) / fraction;

    // Scale: exp((byte / 16) - 10)
    splatF32[dstF32Base + 3] = Math.exp((decompressed[scalesOffset + i * 3] / 16) - 10);
    splatF32[dstF32Base + 4] = Math.exp((decompressed[scalesOffset + i * 3 + 1] / 16) - 10);
    splatF32[dstF32Base + 5] = Math.exp((decompressed[scalesOffset + i * 3 + 2] / 16) - 10);

    // Color RGBA
    var spzR = decompressed[colorsOffset + i * 3];
    var spzG = decompressed[colorsOffset + i * 3 + 1];
    var spzB = decompressed[colorsOffset + i * 3 + 2];
    var colorR = (spzR / 255 - 0.5) * COLOR_SCALE + 0.5;
    var colorG = (spzG / 255 - 0.5) * COLOR_SCALE + 0.5;
    var colorB = (spzB / 255 - 0.5) * COLOR_SCALE + 0.5;
    var alpha = decompressed[alphasOffset + i];

    var colorByteOffset = dstBase + 24;
    splatView.setUint8(colorByteOffset + 0, clampU8(colorR * 255));
    splatView.setUint8(colorByteOffset + 1, clampU8(colorG * 255));
    splatView.setUint8(colorByteOffset + 2, clampU8(colorB * 255));
    splatView.setUint8(colorByteOffset + 3, alpha);

    // Rotation IJKL
    var rx = decompressed[rotationsOffset + i * 3] / 127.5 - 1;
    var ry = decompressed[rotationsOffset + i * 3 + 1] / 127.5 - 1;
    var rz = decompressed[rotationsOffset + i * 3 + 2] / 127.5 - 1;
    var rw = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry - rz * rz));

    var rotByteOffset = dstBase + 28;
    splatView.setUint8(rotByteOffset + 0, clampU8(Math.round(rw * 128) + 128));
    splatView.setUint8(rotByteOffset + 1, clampU8(Math.round(rx * 128) + 128));
    splatView.setUint8(rotByteOffset + 2, clampU8(Math.round(ry * 128) + 128));
    splatView.setUint8(rotByteOffset + 3, clampU8(Math.round(rz * 128) + 128));
  }

  return splatData;
}

self.onmessage = async function(e) {
  try {
    var splatData = await decodeSpz(e.data.buffer);
    self.postMessage({ buffer: splatData.buffer }, [splatData.buffer]);
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
`;
