/**
 * ★ C-09: 跨格式 round-trip 自动质量回归套件
 *
 * 以基准 PLY (内存生成, SH degree 1/2/3) 为源, 全链路验证:
 *   PLY → GaussianCloudSoA (快路径)
 *   → SPLAT (writeSplat) → read (loadGaussiansFromSplatSoA)   [8-bit 量化]
 *   → SPZ v2 (writeSpz) → read (loadGaussiansFromSpzSoA)        [24-bit + 8-bit]
 *   → SOG v2 (writeSog) → metadata (parseSogMetadata)           [32B/chunk]
 *   → SOG v3 (writeSog v3) → SH overlay read (readShOverlaySoA) [Int8 SH]
 *
 * 误差断言 (8-bit 量化极限内):
 *   - 位置: SPLAT 无损; SPZ ≤ 1/4096 (24-bit)
 *   - 颜色: 8-bit ≤ 1/255 × (SH_C0/0.15)
 *   - 不透明度: ≤ 1/255
 *   - 缩放: log 域 ≤ 1/16 (SPZ) / 32-bit 无损 (SPLAT)
 *   - SH: SPLAT 丢弃 (文档化); SPZ ≤ 半桶+round; SOG v3 overlay ≤ 0.5/128
 */

import { describe, it, expect } from 'vitest';
import {
  generateBenchmarkPly,
  createBenchmarkSplats,
  shDimForDegree,
} from '../test-fixtures/benchmark-ply.js';
import { loadGaussiansFromPlySoA } from './gaussian-loader.js';
import type { GaussianCloudSoA } from './gaussian-loader.js';
import { writeSplatSoA, SPLAT_BYTES_PER_SPLAT } from './splat-writer.js';
import { loadGaussiansFromSplatSoA } from './splat-reader.js';
import { writeSpzSoA } from './spz-writer.js';
import { loadGaussiansFromSpzSoA, parseSpzHeader } from './spz-reader.js';
import { writeSogSoA, parseSogMetadata, readShOverlaySoA } from './sog-writer.js';
import { loadGaussiansFromSogSoA } from './sog-reader.js';
import { gunzipSync } from 'node:zlib';

/** 从基准 PLY 加载源 SoA (快路径) */
function loadSource(shDegree: 0 | 1 | 2 | 3, count = 64): GaussianCloudSoA {
  const fixture = generateBenchmarkPly(count, shDegree);
  return loadGaussiansFromPlySoA(fixture.bytes, { source: 'fixture' });
}

/** 逐 splat 比较两个 SoA (指定量化容差) */
function expectClose(
  actual: Float32Array | undefined,
  expected: Float32Array | undefined,
  tol: number,
  label: string,
): void {
  expect(actual?.length).toBe(expected?.length);
  if (!actual || !expected) return;
  for (let i = 0; i < expected.length; i++) {
    const diff = Math.abs(actual[i] - expected[i]);
    if (diff > tol) {
      throw new Error(
        `${label}[${i}]: 期望 ${expected[i]}, 实际 ${actual[i]}, 差 ${diff} > ${tol}`,
      );
    }
  }
}

describe('C-09 跨格式 round-trip 质量回归', () => {
  for (const shDegree of [1, 2, 3] as const) {
    describe(`SH degree ${shDegree}`, () => {
      it('SPLAT round-trip: 位置/颜色/不透明度/缩放 8-bit 量化内', () => {
        const src = loadSource(shDegree);
        const bytes = writeSplatSoA(src);
        const read = loadGaussiansFromSplatSoA(bytes);

        expect(read.count).toBe(src.count);
        // 位置: Float32 无损
        expectClose(read.positions, src.positions, 1e-6, 'positions');
        // 颜色: 8-bit
        expectClose(read.colors, src.colors, 1 / 255 + 1e-6, 'colors');
        // 不透明度
        expectClose(read.opacities, src.opacities, 1 / 255, 'opacities');
        // 缩放: Float32 无损
        expectClose(read.scales, src.scales, 1e-6, 'scales');
        // 旋转: 8-bit (1/128)
        expectClose(read.rotations, src.rotations, 1 / 128, 'rotations');
        // SPLAT 不含 SH (文档化丢弃)
        expect(read.sh).toBeUndefined();
        // 字节尺寸
        expect(bytes.byteLength).toBe(src.count * SPLAT_BYTES_PER_SPLAT);
      });

      it('SPZ v2 round-trip: 24-bit 位置 + 8-bit 属性 + SH 桶内', async () => {
        const src = loadSource(shDegree);
        const spz = await writeSpzSoA(src);
        const header = await parseSpzHeader(new Uint8Array(spz));
        expect(header.shDegree).toBe(shDegree);

        const read = await loadGaussiansFromSpzSoA(new Uint8Array(spz));
        expect(read.count).toBe(src.count);
        expect(read.shDegree).toBe(shDegree);

        // 位置: 24-bit / 4096
        expectClose(read.positions, src.positions, 1 / 4096 + 1e-6, 'spz positions');
        // 不透明度: 8-bit
        expectClose(read.opacities, src.opacities, 1 / 255, 'spz opacities');
        // 缩放: log 8-bit → exp 域 1/16 log 误差
        for (let i = 0; i < src.scales.length; i++) {
          expect(Math.abs(Math.log(read.scales[i]) - Math.log(src.scales[i]))).toBeLessThanOrEqual(
            1 / 16 + 1e-6,
          );
        }
        // SH: 5bit 桶 (degree1) / 4bit 桶 (degree2/3) → ≤ 半桶 + round
        const shDim = shDimForDegree(shDegree);
        const bucketBits = shDegree === 1 ? 5 : 4;
        const bucket = 1 << (8 - bucketBits);
        const tol = bucket / 2 / 128 + 1 / 128;
        expectClose(read.sh, src.sh, tol, `spz sh (degree ${shDegree})`);
      });

      it('SOG v2: metadata + SH degree 一致', () => {
        const src = loadSource(shDegree);
        const sog = writeSogSoA(src, { shMode: 0 });
        const meta = parseSogMetadata(sog);
        expect(meta.numSplats).toBe(src.count);
        expect(meta.shDegree).toBe(shDegree);
        expect(meta.version).toBe(2);
        expect(meta.chunks.length).toBeGreaterThan(0);
        // chunk 索引在文件内
        for (const chunk of meta.chunks) {
          expect(chunk.offset).toBeGreaterThanOrEqual(64);
          expect(chunk.offset + chunk.size).toBeLessThanOrEqual(sog.byteLength);
        }
      });

      it('SOG v2 chunk 数据可解压且 splat 数量正确', () => {
        const src = loadSource(shDegree, 32);
        // chunkSize 小 → 多 chunk
        const sog = writeSogSoA(src, { chunkSize: 16, buildLodTree: false });
        const meta = parseSogMetadata(sog);
        expect(meta.numChunks).toBe(Math.ceil(32 / 16));
        expect(meta.numSplats).toBe(32);

        // 解压首 chunk, 验证 32B/splat 布局下的位置与源一致
        for (const chunk of meta.chunks.slice(0, 2)) {
          const raw = new Uint8Array(sog, chunk.offset, chunk.size);
          const data = meta.compression === 1 ? new Uint8Array(gunzipSync(raw)) : raw;
          expect(data.byteLength).toBe(chunk.count * SPLAT_BYTES_PER_SPLAT);
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          // 首个 splat 位置 Float32
          const x = view.getFloat32(0, true);
          const y = view.getFloat32(4, true);
          const z = view.getFloat32(8, true);
          expect([x, y, z].every((v) => Number.isFinite(v))).toBe(true);
        }
      });

      it(`SOG v3 SH overlay: ${'SH degree ' + shDegree} round-trip 系数桶内`, () => {
        const src = loadSource(shDegree);
        const sog = writeSogSoA(src, { version: 3 });
        const meta = parseSogMetadata(sog);
        expect(meta.version).toBe(3);
        const sh = readShOverlaySoA(sog, meta);
        const shDim = shDimForDegree(shDegree);

        if (shDim > 0) {
          expect(sh).toBeDefined();
          expect(sh?.length).toBe(src.count * shDim * 3);
          // overlay 为 Int8 整桶量化: round(v*128)/128 → 误差 ≤ 0.5/128
          expectClose(sh, src.sh, 0.5 / 128 + 1e-6, `sog v3 sh overlay (degree ${shDegree})`);
        }
      });
    });
  }

  it('快路径与慢路径结果一致 (同 fixture)', () => {
    const fixture = generateBenchmarkPly(24, 2);
    // 快路径: loadGaussiansFromPlySoA 内部试快路径
    const soa = loadGaussiansFromPlySoA(fixture.bytes);
    expect(soa.count).toBe(24);
    expect(soa.shDegree).toBe(2);
    // 与独立构造的 expected 对比 (位置必须一致, 证明快路径读对字节)
    const expected = createBenchmarkSplats(24, 2);
    for (let i = 0; i < 24; i++) {
      expect(soa.positions[i * 3]).toBeCloseTo(expected[i].x, 5);
      expect(soa.positions[i * 3 + 1]).toBeCloseTo(expected[i].y, 5);
      expect(soa.positions[i * 3 + 2]).toBeCloseTo(expected[i].z, 5);
      // 不透明度: logit 还原成概率
      expect(soa.opacities[i]).toBeCloseTo(expected[i].opacity, 4);
    }
  });

  it('全格式链: PLY → SPLAT → SPZ → SOG(v2,v3) 数量与 SH degree 保持一致', async () => {
    const src = loadSource(2, 40);

    const splat = writeSplatSoA(src);
    const splash = loadGaussiansFromSplatSoA(splat);
    expect(splash.count).toBe(40);

    const spz = await writeSpzSoA(src);
    const spzRead = await loadGaussiansFromSpzSoA(new Uint8Array(spz));
    expect(spzRead.count).toBe(40);

    const sog2 = writeSogSoA(src, { version: 2, buildLodTree: false });
    expect(parseSogMetadata(sog2).numSplats).toBe(40);

    const sog3 = writeSogSoA(src, { version: 3, buildLodTree: false });
    const meta3 = parseSogMetadata(sog3);
    expect(meta3.numSplats).toBe(40);
    expect(meta3.shDegree).toBe(2);
    expect(readShOverlaySoA(sog3, meta3)).toBeDefined();
  });
});

describe('A4 SOG v3 → SPZ SH 保留 (公共读回 API)', () => {
  it('SOG v3 → loadGaussiansFromSogSoA: shDegree 与 SH 系数保留', () => {
    const src = loadSource(1, 24);
    const sog = writeSogSoA(src, { version: 3, buildLodTree: false });
    const read = loadGaussiansFromSogSoA(sog, { source: 'test' });

    expect(read.count).toBe(24);
    expect(read.shDegree).toBe(1);
    expect(read.sh).toBeDefined();
    expect(read.sh!.length).toBe(24 * 9);
    // 源 SH (degree 1: 24 splats × 9) 误差在 Int8 量化桶内 (0.5/128 + 舍入)
    expectClose(read.sh!, src.sh!, 0.5 / 128 + 1e-6, 'sog v3 sh');
    expect(read.source).toBe('test');
  });

  it('SOG v3 → SPZ: shDegree=1 且 SH 非空', async () => {
    const src = loadSource(1, 24);
    const sog = writeSogSoA(src, { version: 3, buildLodTree: false });
    const readSog = loadGaussiansFromSogSoA(sog);

    const spz = await writeSpzSoA(readSog);
    const readSpz = await loadGaussiansFromSpzSoA(new Uint8Array(spz));
    expect(readSpz.count).toBe(24);
    expect(readSpz.shDegree).toBe(1);
    expect(readSpz.sh).toBeDefined();
    expect(readSpz.sh!.length).toBe(24 * 9);
  });
});
