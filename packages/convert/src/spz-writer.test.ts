import { describe, it, expect } from 'vitest';
import { writeSpz, SPZ_MAGIC, SPZ_VERSION } from './spz-writer.js';
import type { GaussianCloud, GaussianSplat } from './gaussian-loader.js';

// ── 测试工具 ──────────────────────────────────────────────

/** SPZ header 大小 */
const HEADER_SIZE = 16;

/** Gzip magic number (前 2 字节) */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** SH degree → 每通道系数数 (与 spz-writer.ts 同步) */
const SH_DIM: Record<number, number> = { 0: 0, 1: 3, 2: 8, 3: 15 };

/** 创建测试用高斯核 */
function createTestSplat(i: number): GaussianSplat {
  const t = i / 10;
  return {
    x: (i - 5) * 0.5,
    y: t * 2,
    z: Math.sin(t * Math.PI) * 3,
    scaleX: 0.01 + t * 0.02,
    scaleY: 0.02 + t * 0.01,
    scaleZ: 0.005,
    rotW: 1,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    colorR: 0.5 + 0.3 * Math.sin(t * Math.PI),
    colorG: 0.4,
    colorB: 0.6 + 0.2 * Math.cos(t * Math.PI),
    opacity: 0.7 + t * 0.3,
    shDegree: 0,
  };
}

/** 创建测试用 GaussianCloud */
function createTestCloud(count: number, shDegree = 0): GaussianCloud {
  const splats: GaussianSplat[] = [];
  for (let i = 0; i < count; i++) {
    const s = createTestSplat(i);
    s.shDegree = shDegree;
    splats.push(s);
  }
  return { splats, shDegree, vertexCount: count, source: 'test' };
}

/** gzip 解压 (使用 DecompressionStream, Node.js 18+ 可用) */
async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decompressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressed);
}

/** 解析 SPZ header (与 spz-decoder-worker.ts 同步) */
function parseSpzHeader(data: Uint8Array): {
  magic: number;
  version: number;
  numSplats: number;
  shDegree: number;
  fractionalBits: number;
  flags: number;
} {
  const view = new DataView(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return {
    magic: view.getUint32(0, true),
    version: view.getUint32(4, true),
    numSplats: view.getUint32(8, true),
    shDegree: view.getUint8(12),
    fractionalBits: view.getUint8(13),
    flags: view.getUint8(14),
  };
}

// ── M5 修复验证: Header 未压缩 + Body gzip 压缩 ────────────

describe('writeSpz — M5 修复: Header 未压缩', () => {
  it('★ 输出前 4 字节为 SPZ_MAGIC (非 gzip magic)', async () => {
    const cloud = createTestCloud(10);
    const result = await writeSpz(cloud);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    // SPZ magic = 0x50474853 LE
    expect(view.getUint32(0, true)).toBe(SPZ_MAGIC);

    // 确保不是 gzip magic (0x1f 0x8b)
    expect(result[0]).not.toBe(GZIP_MAGIC_0);
    expect(result[1]).not.toBe(GZIP_MAGIC_1);
  });

  it('★ Header (16 bytes) 全部未压缩 — 字段值正确', async () => {
    const cloud = createTestCloud(20);
    const result = await writeSpz(cloud, { fractionalBits: 12, flagAntiAlias: true });
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    expect(view.getUint32(0, true)).toBe(SPZ_MAGIC);
    expect(view.getUint32(4, true)).toBe(SPZ_VERSION);
    expect(view.getUint32(8, true)).toBe(20);
    expect(view.getUint8(12)).toBe(0);    // shDegree
    expect(view.getUint8(13)).toBe(12);   // fractionalBits
    expect(view.getUint8(14) & 1).toBe(1); // flags: antialiased
    expect(view.getUint8(15)).toBe(0);    // reserved
  });

  it('★ Body 部分 (offset 16+) 为 gzip 压缩数据', async () => {
    const cloud = createTestCloud(5);
    const result = await writeSpz(cloud);

    // gzip 流以 0x1f 0x8b 开头
    expect(result[HEADER_SIZE]).toBe(GZIP_MAGIC_0);
    expect(result[HEADER_SIZE + 1]).toBe(GZIP_MAGIC_1);
  });

  it('★ 输出总长度 = headerSize + gzipBodyLength', async () => {
    const cloud = createTestCloud(100);
    const result = await writeSpz(cloud);

    const compressedBodyLength = result.byteLength - HEADER_SIZE;

    // 原始 body 大小 (100 splats, shDegree=0): 19 bytes/splat
    const rawBodySize = 100 * (9 + 1 + 3 + 3 + 3);

    // gzip 压缩后应小于原始大小
    expect(compressedBodyLength).toBeLessThan(rawBodySize);
    expect(result.byteLength).toBeGreaterThan(HEADER_SIZE);
  });

  it('★ flagAntiAlias=false 时 flags bit 0 = 0', async () => {
    const cloud = createTestCloud(3);
    const result = await writeSpz(cloud, { flagAntiAlias: false });
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    expect(view.getUint8(14) & 1).toBe(0);
  });

  it('★ 不同 shDegree 时 header 正确记录', async () => {
    for (const shDegree of [0, 1, 2, 3]) {
      const cloud = createTestCloud(5, shDegree);
      const result = await writeSpz(cloud, { shDegree });
      const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

      expect(view.getUint8(12)).toBe(shDegree);
    }
  });
});

// ── M5 修复验证: Body 可正确解压 ─────────────────────────

describe('writeSpz — M5 修复: Body gzip 解压验证', () => {
  it('★ Body 解压后大小 = 预期 body 大小', async () => {
    const numSplats = 50;
    const shDegree = 0;
    const cloud = createTestCloud(numSplats, shDegree);
    const result = await writeSpz(cloud);

    // 解压 body
    const compressedBody = result.slice(HEADER_SIZE);
    const decompressed = await gzipDecompress(compressedBody);

    // 预期 body 大小 = positions + alphas + colors + scales + rotations + sh
    const shDim = SH_DIM[shDegree] ?? 0;
    const expectedBodySize = numSplats * (9 + 1 + 3 + 3 + 3) + numSplats * shDim * 3;

    expect(decompressed.byteLength).toBe(expectedBodySize);
  });

  it('★ Body 解压后 position 数据正确', async () => {
    const cloud = createTestCloud(10);
    const result = await writeSpz(cloud, { fractionalBits: 12 });

    const compressedBody = result.slice(HEADER_SIZE);
    const decompressed = await gzipDecompress(compressedBody);

    // Position 在 body 开头, 每个 splat 9 bytes (3 × 24-bit int)
    // 验证第一个 splat 的 position
    const fraction = 1 << 12;
    const readInt24LE = (offset: number): number => {
      const lo = decompressed[offset];
      const mid = decompressed[offset + 1];
      const hi = decompressed[offset + 2];
      let val = lo | (mid << 8) | (hi << 16);
      if (val & 0x800000) val -= 0x1000000;
      return val;
    };

    const px = readInt24LE(0) / fraction;
    const py = readInt24LE(3) / fraction;
    const pz = readInt24LE(6) / fraction;

    expect(px).toBeCloseTo(cloud.splats[0].x, 1);
    expect(py).toBeCloseTo(cloud.splats[0].y, 1);
    expect(pz).toBeCloseTo(cloud.splats[0].z, 1);
  });

  it('★ Body 解压后 alpha 数据正确', async () => {
    const cloud = createTestCloud(5);
    const result = await writeSpz(cloud);

    const compressedBody = result.slice(HEADER_SIZE);
    const decompressed = await gzipDecompress(compressedBody);

    // Alpha 在 positions 之后: offset = numSplats * 9
    const alphaOffset = 5 * 9;
    for (let i = 0; i < 5; i++) {
      const expectedAlpha = Math.max(0, Math.min(255, Math.round(cloud.splats[i].opacity * 255)));
      expect(decompressed[alphaOffset + i]).toBe(expectedAlpha);
    }
  });

  it('★ SH degree > 0 时 body 包含 SH 数据', async () => {
    const numSplats = 5;
    const shDegree = 1;
    const cloud = createTestCloud(numSplats, shDegree);
    const result = await writeSpz(cloud, { shDegree });

    const compressedBody = result.slice(HEADER_SIZE);
    const decompressed = await gzipDecompress(compressedBody);

    const shDim = SH_DIM[shDegree]; // 3
    const expectedBodySize = numSplats * (9 + 1 + 3 + 3 + 3) + numSplats * shDim * 3;

    expect(decompressed.byteLength).toBe(expectedBodySize);
  });
});

// ── M5 修复验证: parseSpzHeader 兼容性 ───────────────────

describe('writeSpz — M5 修复: Header 解析兼容性', () => {
  it('★ writeSpz 输出可被 parseSpzHeader 正确解析', async () => {
    const cloud = createTestCloud(15);
    const result = await writeSpz(cloud);

    const header = parseSpzHeader(result);

    expect(header.magic).toBe(SPZ_MAGIC);
    expect(header.version).toBe(SPZ_VERSION);
    expect(header.numSplats).toBe(15);
    expect(header.shDegree).toBe(0);
    expect(header.fractionalBits).toBe(12);
  });

  it('★ header magic 校验通过 (不抛异常)', async () => {
    const cloud = createTestCloud(3);
    const result = await writeSpz(cloud);
    const header = parseSpzHeader(result);

    expect(header.magic).toBe(SPZ_MAGIC);
    expect(header.version).toBe(2);
    // validateSpzHeader 等效检查
    expect(header.magic).not.toBe(0x00088b1f); // gzip magic LE
  });
});

// ── 边界条件 ─────────────────────────────────────────────

describe('writeSpz — 边界条件', () => {
  it('单个 splat 也能正确生成 (header 未压缩)', async () => {
    const cloud = createTestCloud(1);
    const result = await writeSpz(cloud);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    expect(view.getUint32(0, true)).toBe(SPZ_MAGIC);
    expect(view.getUint32(8, true)).toBe(1);
  });

  it('空 cloud (0 splats) 也能正确生成 header', async () => {
    const cloud = createTestCloud(0);
    const result = await writeSpz(cloud);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    expect(view.getUint32(0, true)).toBe(SPZ_MAGIC);
    expect(view.getUint32(8, true)).toBe(0);
    expect(result.byteLength).toBeGreaterThanOrEqual(HEADER_SIZE);
  });

  it('自定义 fractionalBits 在 header 中正确记录', async () => {
    const cloud = createTestCloud(5);
    const result = await writeSpz(cloud, { fractionalBits: 10 });
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    expect(view.getUint8(13)).toBe(10);
  });
});
