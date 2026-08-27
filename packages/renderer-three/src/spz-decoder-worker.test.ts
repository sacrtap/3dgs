import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decodeSpz,
  decodeSpzInWorker,
  parseSpzHeader,
  readSpzHeader,
  validateSpzHeader,
  SPZ_MAGIC,
  SPZ_VERSION,
  type SpzHeader,
} from './spz-decoder-worker.js';

// ── SPZ 文件构造工具 ──────────────────────────────────────

/** SH C0 常数 (与 spz-writer.ts 同步) */
const SH_C0 = 0.28209479177387814;

/** SPZ 颜色缩放常数 (与 spz-writer.ts 同步) */
const SPZ_COLOR_SCALE = 0.15;

/** SH_C0 / SPZ_COLOR_SCALE */
const COLOR_SCALE = SH_C0 / SPZ_COLOR_SCALE;

/** .splat 每高斯核字节数 */
const SPLAT_BYTES = 32;

/** SPZ header 大小 */
const HEADER_SIZE = 16;

/** SH degree → 每通道系数数 */
const SH_DIM: Record<number, number> = { 0: 0, 1: 3, 2: 8, 3: 15 };

/** 测试用高斯核数据 */
interface TestSplat {
  x: number; y: number; z: number;
  scaleX: number; scaleY: number; scaleZ: number;
  rotW: number; rotX: number; rotY: number; rotZ: number;
  colorR: number; colorG: number; colorB: number;
  opacity: number;
}

/** Clamp 到 0-255 */
function clampU8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** 写入 24-bit 有符号整数 (little-endian) */
function writeInt24LE(view: DataView, offset: number, value: number): void {
  view.setUint8(offset, value & 0xff);
  view.setUint8(offset + 1, (value >> 8) & 0xff);
  view.setUint8(offset + 2, (value >> 16) & 0xff);
}

/**
 * 构造一个完整的 SPZ v2 文件 (gzip 压缩)
 *
 * [来源: 编码逻辑 — packages/convert/src/spz-writer.ts]
 */
async function createMockSpzFile(
  splats: TestSplat[],
  opts?: { shDegree?: number; fractionalBits?: number },
): Promise<ArrayBuffer> {
  const numSplats = splats.length;
  const shDegree = opts?.shDegree ?? 0;
  const fractionalBits = opts?.fractionalBits ?? 12;
  const fraction = 1 << fractionalBits;
  const shDim = SH_DIM[shDegree] ?? 0;

  const positionsSize = numSplats * 9;
  const alphasSize = numSplats;
  const colorsSize = numSplats * 3;
  const scalesSize = numSplats * 3;
  const rotationsSize = numSplats * 3;
  const shSize = numSplats * shDim * 3;

  const bodySize = positionsSize + alphasSize + colorsSize + scalesSize + rotationsSize + shSize;
  const totalSize = HEADER_SIZE + bodySize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // ── Header (16 bytes) ──
  view.setUint32(0, SPZ_MAGIC, true);
  view.setUint32(4, SPZ_VERSION, true);
  view.setUint32(8, numSplats, true);
  view.setUint8(12, shDegree);
  view.setUint8(13, fractionalBits);
  view.setUint8(14, 1); // flagAntiAlias
  view.setUint8(15, 0); // reserved

  // ── 1. Positions ──
  let offset = HEADER_SIZE;
  for (const s of splats) {
    writeInt24LE(view, offset, Math.max(-8388607, Math.min(8388607, Math.round(s.x * fraction))));
    writeInt24LE(view, offset + 3, Math.max(-8388607, Math.min(8388607, Math.round(s.y * fraction))));
    writeInt24LE(view, offset + 6, Math.max(-8388607, Math.min(8388607, Math.round(s.z * fraction))));
    offset += 9;
  }

  // ── 2. Alphas ──
  for (let i = 0; i < numSplats; i++) {
    view.setUint8(offset + i, clampU8(Math.round(splats[i].opacity * 255)));
  }
  offset += alphasSize;

  // ── 3. Colors ──
  for (let i = 0; i < numSplats; i++) {
    const s = splats[i];
    const base = offset + i * 3;
    view.setUint8(base + 0, clampU8(Math.round(((s.colorR - 0.5) / COLOR_SCALE + 0.5) * 255)));
    view.setUint8(base + 1, clampU8(Math.round(((s.colorG - 0.5) / COLOR_SCALE + 0.5) * 255)));
    view.setUint8(base + 2, clampU8(Math.round(((s.colorB - 0.5) / COLOR_SCALE + 0.5) * 255)));
  }
  offset += colorsSize;

  // ── 4. Scales ──
  for (let i = 0; i < numSplats; i++) {
    const s = splats[i];
    const base = offset + i * 3;
    view.setUint8(base + 0, clampU8(Math.round((Math.log(Math.max(s.scaleX, 1e-10)) + 10) * 16)));
    view.setUint8(base + 1, clampU8(Math.round((Math.log(Math.max(s.scaleY, 1e-10)) + 10) * 16)));
    view.setUint8(base + 2, clampU8(Math.round((Math.log(Math.max(s.scaleZ, 1e-10)) + 10) * 16)));
  }
  offset += scalesSize;

  // ── 5. Rotations (xyz, normalized, w >= 0) ──
  for (let i = 0; i < numSplats; i++) {
    const s = splats[i];
    const len = Math.sqrt(s.rotW * s.rotW + s.rotX * s.rotX + s.rotY * s.rotY + s.rotZ * s.rotZ);
    let nw = s.rotW / len, nx = s.rotX / len, ny = s.rotY / len, nz = s.rotZ / len;
    if (nw < 0) { nw = -nw; nx = -nx; ny = -ny; nz = -nz; }
    const base = offset + i * 3;
    view.setUint8(base + 0, clampU8(Math.round((nx + 1) * 127.5)));
    view.setUint8(base + 1, clampU8(Math.round((ny + 1) * 127.5)));
    view.setUint8(base + 2, clampU8(Math.round((nz + 1) * 127.5)));
  }
  offset += rotationsSize;

  // SH data (fill with 128 = neutral)
  for (let i = offset; i < totalSize; i++) {
    u8[i] = 128;
  }

  // ── Gzip compress body ──
  const body = u8.slice(HEADER_SIZE);
  const compressed = await gzipCompress(body);

  // 合并 header + compressed body
  const result = new Uint8Array(HEADER_SIZE + compressed.byteLength);
  result.set(u8.slice(0, HEADER_SIZE), 0);
  result.set(compressed, HEADER_SIZE);

  return result.buffer;
}

/** Gzip 压缩 */
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

/** 创建测试用高斯核数据 */
function createTestSplats(count: number): TestSplat[] {
  const splats: TestSplat[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    splats.push({
      x: (i - count / 2) * 0.1,
      y: t * 10 - 5,
      z: Math.sin(t * Math.PI * 2) * 3,
      scaleX: 0.01 + t * 0.05,
      scaleY: 0.02 + t * 0.03,
      scaleZ: 0.005 + t * 0.01,
      rotW: 1,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      colorR: 0.5 + 0.5 * Math.sin(t * Math.PI),
      colorG: 0.3,
      colorB: 0.7,
      opacity: 0.8 + t * 0.2,
    });
  }
  return splats;
}

// ── 测试 ──────────────────────────────────────────────────

describe('parseSpzHeader — SPZ header 解析', () => {
  it('正确解析 header 字段', async () => {
    const splats = createTestSplats(3);
    const spzData = await createMockSpzFile(splats, { fractionalBits: 12 });
    const header = parseSpzHeader(spzData);

    expect(header.magic).toBe(SPZ_MAGIC);
    expect(header.version).toBe(SPZ_VERSION);
    expect(header.numSplats).toBe(3);
    expect(header.shDegree).toBe(0);
    expect(header.fractionalBits).toBe(12);
  });

  it('支持不同 fractionalBits', async () => {
    const splats = createTestSplats(2);
    const spzData = await createMockSpzFile(splats, { fractionalBits: 10 });
    const header = parseSpzHeader(spzData);

    expect(header.fractionalBits).toBe(10);
  });

  it('支持不同 shDegree', async () => {
    const splats = createTestSplats(2);
    const spzData = await createMockSpzFile(splats, { shDegree: 1 });
    const header = parseSpzHeader(spzData);

    expect(header.shDegree).toBe(1);
  });

  it('接受 Uint8Array 输入', async () => {
    const splats = createTestSplats(1);
    const spzData = await createMockSpzFile(splats);
    const header = parseSpzHeader(new Uint8Array(spzData));

    expect(header.numSplats).toBe(1);
  });
});

describe('validateSpzHeader — header 验证', () => {
  it('有效 header 不抛出异常', async () => {
    const splats = createTestSplats(1);
    const spzData = await createMockSpzFile(splats);
    const header = parseSpzHeader(spzData);
    expect(() => validateSpzHeader(header)).not.toThrow();
  });

  it('无效 magic 抛出异常', () => {
    const header: SpzHeader = {
      magic: 0xDEADBEEF, version: 2, numSplats: 1, shDegree: 0, fractionalBits: 12, flags: 0,
    };
    expect(() => validateSpzHeader(header)).toThrow(/magic 不匹配/);
  });

  it('不支持的版本抛出异常', () => {
    const header: SpzHeader = {
      magic: SPZ_MAGIC, version: 99, numSplats: 1, shDegree: 0, fractionalBits: 12, flags: 0,
    };
    expect(() => validateSpzHeader(header)).toThrow(/版本/);
  });
});

describe('decodeSpz — SPZ → .splat 解码 (主线程)', () => {
  it('解码后字节数 = numSplats × 32', async () => {
    const numSplats = 10;
    const splats = createTestSplats(numSplats);
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);

    expect(splatBytes.byteLength).toBe(numSplats * SPLAT_BYTES);
  });

  it('★ Position 反量化正确 (24-bit int → Float32)', async () => {
    const splats: TestSplat[] = [
      { x: 1.5, y: -2.3, z: 0.0, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];
    const spzData = await createMockSpzFile(splats, { fractionalBits: 12 });
    const splatBytes = await decodeSpz(spzData);
    const view = new DataView(splatBytes.buffer);

    const fraction = 1 << 12;
    expect(view.getFloat32(0, true)).toBeCloseTo(1.5, 3);
    expect(view.getFloat32(4, true)).toBeCloseTo(-2.3, 3);
    expect(view.getFloat32(8, true)).toBeCloseTo(0.0, 3);
  });

  it('★ Scale 反量化正确 (log-scale → Float32)', async () => {
    const splats: TestSplat[] = [
      { x: 0, y: 0, z: 0, scaleX: 0.05, scaleY: 0.01, scaleZ: 0.1, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);
    const view = new DataView(splatBytes.buffer);

    // Scale at byte offset 12-23
    expect(view.getFloat32(12, true)).toBeCloseTo(0.05, 2);
    expect(view.getFloat32(16, true)).toBeCloseTo(0.01, 2);
    expect(view.getFloat32(20, true)).toBeCloseTo(0.1, 2);
  });

  it('★ Color 反量化正确 (DC color encoded → Uint8 RGBA)', async () => {
    const splats: TestSplat[] = [
      { x: 0, y: 0, z: 0, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.8, colorG: 0.2, colorB: 0.6, opacity: 0.9 },
    ];
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);

    // Color RGBA at byte offset 24-27
    const r = splatBytes[24];
    const g = splatBytes[25];
    const b = splatBytes[26];
    const a = splatBytes[27];

    // Verify alpha (direct copy)
    expect(a).toBe(clampU8(Math.round(0.9 * 255)));

    // Verify color (reverse quantized)
    const expectedR = clampU8((((clampU8(Math.round(((0.8 - 0.5) / COLOR_SCALE + 0.5) * 255)) / 255 - 0.5) * COLOR_SCALE + 0.5) * 255));
    expect(r).toBe(expectedR);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(255);
  });

  it('★ Rotation 反量化正确 (xyz + w=sqrt → IJKL)', async () => {
    // Identity quaternion: w=1, x=0, y=0, z=0
    const splats: TestSplat[] = [
      { x: 0, y: 0, z: 0, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);

    // Rotation IJKL at byte offset 28-31
    // .splat format: value = round(component * 128) + 128
    //
    // SPZ 量化: byte = round((component + 1) * 127.5)
    //   对于 component=0: byte = round(127.5) = 128
    // SPZ 反量化: component = byte / 127.5 - 1
    //   对于 byte=128: component = 128/127.5 - 1 ≈ 0.00392
    // .splat 量化: byte = round(0.00392 * 128) + 128 = round(0.5) + 128 = 129
    //
    // 这是 SPZ (127.5 scale) 和 .splat (128 scale) 之间的固有量化差异。
    // w = sqrt(1 - 3*0.00392²) ≈ 0.99998 → round(0.99998*128)+128 = 256 → clamped to 255
    expect(splatBytes[28]).toBe(255); // w ≈ 1 → clamped to 255
    // x, y, z ≈ 0.00392 → round(0.00392*128)+128 = 129 (量化误差 ±1)
    expect(splatBytes[29]).toBeGreaterThanOrEqual(128);
    expect(splatBytes[29]).toBeLessThanOrEqual(129);
    expect(splatBytes[30]).toBeGreaterThanOrEqual(128);
    expect(splatBytes[30]).toBeLessThanOrEqual(129);
    expect(splatBytes[31]).toBeGreaterThanOrEqual(128);
    expect(splatBytes[31]).toBeLessThanOrEqual(129);
  });

  it('多个 splat 解码正确', async () => {
    const numSplats = 50;
    const splats = createTestSplats(numSplats);
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);

    expect(splatBytes.byteLength).toBe(numSplats * SPLAT_BYTES);

    // 验证每个 splat 的 position
    const view = new DataView(splatBytes.buffer);
    for (let i = 0; i < numSplats; i++) {
      const base = i * SPLAT_BYTES;
      const px = view.getFloat32(base + 0, true);
      const py = view.getFloat32(base + 4, true);
      const pz = view.getFloat32(base + 8, true);

      // Position should be approximately equal to original
      expect(px).toBeCloseTo(splats[i].x, 1);
      expect(py).toBeCloseTo(splats[i].y, 1);
      expect(pz).toBeCloseTo(splats[i].z, 1);
    }
  });

  it('空文件 (0 splats) 不崩溃', async () => {
    const spzData = await createMockSpzFile([]);
    const splatBytes = await decodeSpz(spzData);
    expect(splatBytes.byteLength).toBe(0);
  });

  it('无效 magic 抛出异常', async () => {
    const badData = new ArrayBuffer(16);
    const view = new DataView(badData);
    view.setUint32(0, 0xDEADBEEF, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 0, true);

    await expect(decodeSpz(badData)).rejects.toThrow(/magic 不匹配/);
  });

  it('无效版本抛出异常', async () => {
    const badData = new ArrayBuffer(16);
    const view = new DataView(badData);
    view.setUint32(0, SPZ_MAGIC, true);
    view.setUint32(4, 99, true);
    view.setUint32(8, 0, true);

    await expect(decodeSpz(badData)).rejects.toThrow(/版本/);
  });
});

// ── P1-4: Worker 解码测试 ───────────────────────────────────

describe('decodeSpzInWorker — Worker 解码 (Node 环境回退主线程)', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    // Node.js 环境没有 Worker, 模拟回退
    // @ts-expect-error — 删除全局 Worker
    delete globalThis.Worker;
  });

  afterEach(() => {
    if (originalWorker) {
      globalThis.Worker = originalWorker;
    }
    vi.restoreAllMocks();
  });

  it('★ Worker 不可用时回退到主线程解码', async () => {
    const numSplats = 5;
    const splats = createTestSplats(numSplats);
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpzInWorker(spzData);

    expect(splatBytes.byteLength).toBe(numSplats * SPLAT_BYTES);
  });

  it('回退解码结果与主线程一致', async () => {
    const numSplats = 10;
    const splats = createTestSplats(numSplats);
    const spzData = await createMockSpzFile(splats);

    const directResult = await decodeSpz(spzData);
    const workerResult = await decodeSpzInWorker(spzData);

    expect(workerResult.byteLength).toBe(directResult.byteLength);
    // 逐字节比较
    for (let i = 0; i < directResult.byteLength; i++) {
      expect(workerResult[i]).toBe(directResult[i]);
    }
  });

  it('错误传播: 无效数据抛出异常', async () => {
    const badData = new ArrayBuffer(16);
    const view = new DataView(badData);
    view.setUint32(0, 0xDEADBEEF, true);

    await expect(decodeSpzInWorker(badData)).rejects.toThrow(/magic 不匹配/);
  });
});

// ── 边界条件测试 ───────────────────────────────────────────

describe('decodeSpz — 边界条件', () => {
  it('大坐标值正确处理 (接近 24-bit 上限)', async () => {
    const splats: TestSplat[] = [
      { x: 2000, y: -2000, z: 1000, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];
    const spzData = await createMockSpzFile(splats, { fractionalBits: 12 });
    const splatBytes = await decodeSpz(spzData);
    const view = new DataView(splatBytes.buffer);

    // 2000 * 4096 = 8192000, within 24-bit range (8388607)
    expect(view.getFloat32(0, true)).toBeCloseTo(2000, 1);
    expect(view.getFloat32(4, true)).toBeCloseTo(-2000, 1);
    expect(view.getFloat32(8, true)).toBeCloseTo(1000, 1);
  });

  it('极小 scale 值正确处理', async () => {
    const splats: TestSplat[] = [
      { x: 0, y: 0, z: 0, scaleX: 0.0001, scaleY: 0.001, scaleZ: 0.00001, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);
    const view = new DataView(splatBytes.buffer);

    expect(view.getFloat32(12, true)).toBeCloseTo(0.0001, 3);
    expect(view.getFloat32(16, true)).toBeCloseTo(0.001, 3);
    expect(view.getFloat32(20, true)).toBeCloseTo(0.00001, 4);
  });

  it('非归一化四元数正确处理 (SPZ 编码会归一化)', async () => {
    const splats: TestSplat[] = [
      { x: 0, y: 0, z: 0, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 2, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];
    const spzData = await createMockSpzFile(splats);
    const splatBytes = await decodeSpz(spzData);

    // rotW=2 normalized → w=1, so w byte should be 255
    expect(splatBytes[28]).toBe(255);
  });

  it('不同 fractionalBits 产生一致结果', async () => {
    const splats: TestSplat[] = [
      { x: 1.234, y: -5.678, z: 9.012, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, colorR: 0.5, colorG: 0.5, colorB: 0.5, opacity: 1 },
    ];

    const spzData12 = await createMockSpzFile(splats, { fractionalBits: 12 });
    const spzData10 = await createMockSpzFile(splats, { fractionalBits: 10 });

    const result12 = await decodeSpz(spzData12);
    const result10 = await decodeSpz(spzData10);

    const view12 = new DataView(result12.buffer);
    const view10 = new DataView(result10.buffer);

    // Higher fractionalBits = more precision, both should be close to original
    expect(view12.getFloat32(0, true)).toBeCloseTo(1.234, 2);
    expect(view10.getFloat32(0, true)).toBeCloseTo(1.234, 1);
  });

  it('SH degree > 0 的文件可正常解码 (SH 数据被跳过)', async () => {
    const splats = createTestSplats(5);
    const spzData = await createMockSpzFile(splats, { shDegree: 1 });
    const splatBytes = await decodeSpz(spzData);

    expect(splatBytes.byteLength).toBe(5 * SPLAT_BYTES);
  });
});

// ── 权威布局 (2026-08-27): 整文件单个 gzip 流 ─────────────

describe('decodeSpz — 权威布局: 整文件 gzip (Spark 兼容)', () => {
  /** Gzip 解压 */
  async function gzipDecompressLocal(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** 构造权威布局文件: 将旧布局 [未压缩 header][gzip body] 转为 [整文件 gzip] */
  async function createWholeGzipSpz(splats: TestSplat[], opts?: { shDegree?: number }): Promise<ArrayBuffer> {
    const legacy = new Uint8Array(await createMockSpzFile(splats, opts));
    const body = await gzipDecompressLocal(legacy.subarray(HEADER_SIZE));
    const full = new Uint8Array(HEADER_SIZE + body.length);
    full.set(legacy.subarray(0, HEADER_SIZE), 0);
    full.set(body, HEADER_SIZE);
    return (await gzipCompress(full)).buffer as ArrayBuffer;
  }

  it('★ 文件以 gzip magic 开头, decodeSpz 自动识别并解码', async () => {
    const splats = createTestSplats(4);
    const spzData = await createWholeGzipSpz(splats);

    expect(new Uint8Array(spzData)[0]).toBe(0x1f);
    expect(new Uint8Array(spzData)[1]).toBe(0x8b);

    const splatBytes = await decodeSpz(spzData);
    expect(splatBytes.byteLength).toBe(4 * SPLAT_BYTES);

    // 位置 round-trip
    const view = new DataView(splatBytes.buffer);
    expect(view.getFloat32(0, true)).toBeCloseTo(splats[0].x, 1);
    expect(view.getFloat32(4, true)).toBeCloseTo(splats[0].y, 1);
    expect(view.getFloat32(8, true)).toBeCloseTo(splats[0].z, 1);
  });

  it('★ readSpzHeader 对权威布局返回正确元信息', async () => {
    const splats = createTestSplats(7);
    const spzData = await createWholeGzipSpz(splats);

    const header = await readSpzHeader(spzData);
    expect(header.magic).toBe(SPZ_MAGIC);
    expect(header.version).toBe(SPZ_VERSION);
    expect(header.numSplats).toBe(7);
  });

  it('★ readSpzHeader 对旧布局 (未压缩 header) 同样兼容', async () => {
    const splats = createTestSplats(6);
    const legacyData = await createMockSpzFile(splats);

    const header = await readSpzHeader(legacyData);
    expect(header.numSplats).toBe(6);
  });

  it('★ 两种布局解码结果一致 (布局迁移无损)', async () => {
    const splats = createTestSplats(5);
    const legacyData = await createMockSpzFile(splats);
    const wholeData = await createWholeGzipSpz(splats);

    const fromLegacy = await decodeSpz(legacyData);
    const fromWhole = await decodeSpz(wholeData);

    expect(Array.from(fromWhole)).toEqual(Array.from(fromLegacy));
  });
});
