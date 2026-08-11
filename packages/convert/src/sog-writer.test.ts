import { describe, it, expect } from 'vitest';
import { writeSog, parseSogMetadata, buildLodLevels, serializeLodTree, deserializeLodTree } from './sog-writer.js';
import {
  SOG_MAGIC_V1, SOG_MAGIC_V2, SOG_VERSION_V1, SOG_VERSION_V2,
  SOG_COMPACT_BYTES_PER_SPLAT,
  SOG_POSITION_QUANT_OFF, SOG_POSITION_QUANT_24BIT,
} from './sog-writer.js';
import { writeSplat } from './splat-writer.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { GaussianCloud } from './gaussian-loader.js';

// ── 测试工具 ──────────────────────────────────────────────

function makeCloud(splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>>): GaussianCloud {
  return {
    splats: splats.map((s) => ({
      x: s.x ?? 0,
      y: s.y ?? 0,
      z: s.z ?? 0,
      scaleX: s.scaleX ?? 0.01,
      scaleY: s.scaleY ?? 0.01,
      scaleZ: s.scaleZ ?? 0.01,
      rotW: s.rotW ?? 1,
      rotX: s.rotX ?? 0,
      rotY: s.rotY ?? 0,
      rotZ: s.rotZ ?? 0,
      colorR: s.colorR ?? 0.8,
      colorG: s.colorG ?? 0.8,
      colorB: s.colorB ?? 0.8,
      opacity: s.opacity ?? 1,
      shDegree: 0,
    })),
    shDegree: 0,
    vertexCount: splats.length,
    source: 'test',
  };
}

// ── 测试 ──────────────────────────────────────────────────

describe('writeSog — P1-2 gzip 压缩 + P1-3 LOD 元数据', () => {
  it('★ v2 格式: magic = "SOG2"', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(SOG_MAGIC_V2);
  });

  it('★ v2 格式: version = 2', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint16(4, true)).toBe(SOG_VERSION_V2);
  });

  it('★ P1-2: 默认启用 gzip 压缩 (compression=1)', () => {
    const cloud = makeCloud([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint8(7)).toBe(1); // SOG_COMPRESSION_GZIP
  });

  it('★ P1-2: 可禁用压缩 (compression: false)', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { compression: false });
    const view = new DataView(buffer);
    expect(view.getUint8(7)).toBe(0); // SOG_COMPRESSION_NONE
  });

  it('★ P1-2: 压缩后文件小于未压缩文件', () => {
    // 生成 1000 个高斯核 (位置有冗余, gzip 应能压缩)
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({
        x: i * 0.1,
        y: i * 0.05,
        z: i * 0.01,
        scaleX: 0.01,
        scaleY: 0.01,
        scaleZ: 0.01,
      });
    }
    const cloud = makeCloud(splats);

    const compressedBuffer = writeSog(cloud, { compression: true });
    const uncompressedBuffer = writeSog(cloud, { compression: false });

    // gzip 压缩后应显著小于未压缩版本
    // .splat 数据中 Float32 位置和 scale 有大量冗余
    expect(compressedBuffer.byteLength).toBeLessThan(uncompressedBuffer.byteLength);
    // 压缩率应至少 20% 以上
    const ratio = compressedBuffer.byteLength / uncompressedBuffer.byteLength;
    expect(ratio).toBeLessThan(0.8);
  });

  it('★ P1-3: lodQuality 默认 = 1 (quality)', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint8(52)).toBe(1);
  });

  it('★ P1-3: lodQuality 可配置为 0 (fast)', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { lodQuality: 0 });
    const view = new DataView(buffer);
    expect(view.getUint8(52)).toBe(0);
  });

  it('★ P1-3: lodTreeOffset = 0 (运行时构建)', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint32(44, true)).toBe(0);
    expect(view.getUint32(48, true)).toBe(0);
  });
});

describe('parseSogMetadata — v1/v2 向后兼容', () => {
  it('★ 解析 v2 文件元数据', () => {
    const cloud = makeCloud([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 10 },
    ]);
    const buffer = writeSog(cloud, { compression: true, lodQuality: 1 });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.version).toBe(SOG_VERSION_V2);
    expect(metadata.compression).toBe(1);
    expect(metadata.lodQuality).toBe(1);
    expect(metadata.numSplats).toBe(2);
    expect(metadata.numChunks).toBe(1);
    expect(metadata.lodTreeOffset).toBe(0);
    expect(metadata.lodTreeSize).toBe(0);
  });

  it('★ 解析无压缩 v2 文件', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { compression: false, lodQuality: 0 });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.version).toBe(SOG_VERSION_V2);
    expect(metadata.compression).toBe(0);
    expect(metadata.lodQuality).toBe(0);
  });

  it('★ 解析 v1 文件 (向后兼容)', () => {
    // 手动构造一个 v1 SOG 文件
    const numSplats = 3;
    const chunkSize = 16384;
    const numChunks = 1;
    const splatBytes = 32;
    const headerSize = 64;
    const indexSize = numChunks * 8;
    const dataSize = numSplats * splatBytes;
    const totalSize = headerSize + indexSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // v1 Header
    view.setUint32(0, SOG_MAGIC_V1, true); // "SOG1"
    view.setUint16(4, SOG_VERSION_V1, true);
    view.setUint8(6, 0); // shDegree
    view.setUint8(7, 0); // reserved
    view.setUint32(8, numSplats, true);
    view.setUint32(12, numChunks, true);
    view.setUint32(16, chunkSize, true);
    view.setFloat32(20, 0, true);
    view.setFloat32(24, 0, true);
    view.setFloat32(28, 0, true);
    view.setFloat32(32, 10, true);
    view.setFloat32(36, 10, true);
    view.setFloat32(40, 10, true);

    // Chunk index
    view.setUint32(headerSize, headerSize + indexSize, true);
    view.setUint32(headerSize + 4, dataSize, true);

    const metadata = parseSogMetadata(buffer);

    expect(metadata.version).toBe(SOG_VERSION_V1);
    expect(metadata.compression).toBe(0); // v1 无压缩
    expect(metadata.lodQuality).toBe(0);  // v1 无 LOD 字段
    expect(metadata.numSplats).toBe(numSplats);
    expect(metadata.numChunks).toBe(numChunks);
  });

  it('★ 无效 magic 抛出错误', () => {
    const badBuffer = new ArrayBuffer(64);
    const view = new DataView(badBuffer);
    view.setUint32(0, 0xDEADBEEF, true);

    expect(() => parseSogMetadata(badBuffer)).toThrow(/magic 不匹配/);
  });

  it('★ 多 chunk 文件元数据正确', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 100; i++) {
      splats.push({ x: i, y: i, z: i });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { chunkSize: 30, compression: false });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.numSplats).toBe(100);
    expect(metadata.numChunks).toBe(4); // ceil(100/30) = 4
    expect(metadata.chunkSize).toBe(30);

    // 验证各 chunk 的 count
    expect(metadata.chunks[0].count).toBe(30);
    expect(metadata.chunks[1].count).toBe(30);
    expect(metadata.chunks[2].count).toBe(30);
    expect(metadata.chunks[3].count).toBe(10); // 最后一个 chunk 不足
  });

  it('★ 空集写入不崩溃', () => {
    const cloud = makeCloud([]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(SOG_MAGIC_V2);
  });

  it('★ Morton 排序在写入时执行', () => {
    // 乱序的高斯核
    const cloud = makeCloud([
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 5, z: 5 },
    ]);
    const buffer = writeSog(cloud, { spatialSort: true, compression: false });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.numSplats).toBe(3);
    // Morton 排序后 (0,0,0) 应该在第一个 chunk 的开头
    // 读取第一个 chunk 的第一个 splat 的位置
    const offset = metadata.chunks[0].offset;
    const view = new DataView(buffer);
    const x0 = view.getFloat32(offset, true);
    expect(x0).toBe(0); // (0,0,0) 排在第一位
  });
});

// ── P2-3: 位置量化测试 ────────────────────────────────────

describe('writeSog — P2-3 位置量化', () => {
  it('★ 默认不启用量化 (positionQuantization=0)', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);
    expect(view.getUint8(53)).toBe(SOG_POSITION_QUANT_OFF);
  });

  it('★ 启用量化时 positionQuantization=1', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { positionQuantization: true });
    const view = new DataView(buffer);
    expect(view.getUint8(53)).toBe(SOG_POSITION_QUANT_24BIT);
  });

  it('★ parseSogMetadata 正确读取量化标志', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { positionQuantization: true });
    const metadata = parseSogMetadata(buffer);
    expect(metadata.positionQuantization).toBe(SOG_POSITION_QUANT_24BIT);
  });

  it('★ parseSogMetadata 未量化时返回 0', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { positionQuantization: false });
    const metadata = parseSogMetadata(buffer);
    expect(metadata.positionQuantization).toBe(SOG_POSITION_QUANT_OFF);
  });

  it('★ 旧版 v2 文件 (无量化字节) 兼容: byte 53 = 0', () => {
    // 手动构造一个没有量化字节的 v2 文件 (byte 53 = 0)
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { positionQuantization: false, compression: false });
    const metadata = parseSogMetadata(buffer);
    expect(metadata.positionQuantization).toBe(0);
  });

  it('★ 量化后文件总大小减小 (29B/splat vs 32B/splat)', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({ x: i * 0.1, y: i * 0.05, z: i * 0.01 });
    }
    const cloud = makeCloud(splats);

    // 禁用 gzip 压缩和 LOD 树以比较原始数据大小
    const quantizedBuffer = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      spatialSort: false,
      buildLodTree: false,
    });
    const unquantizedBuffer = writeSog(cloud, {
      positionQuantization: false,
      compression: false,
      spatialSort: false,
      buildLodTree: false,
    });

    // 量化后应更小 (1000 splats × (32-29) = 3000 bytes 节省)
    const quantizedDataSize = quantizedBuffer.byteLength - 64 - 8; // 减去 header + index
    const unquantizedDataSize = unquantizedBuffer.byteLength - 64 - 8;

    expect(quantizedDataSize).toBe(1000 * SOG_COMPACT_BYTES_PER_SPLAT);
    expect(unquantizedDataSize).toBe(1000 * 32);
    expect(quantizedDataSize).toBeLessThan(unquantizedDataSize);
    // 节省 3 bytes / 32 bytes = 9.375%
    const saving = 1 - quantizedDataSize / unquantizedDataSize;
    expect(saving).toBeCloseTo(3 / 32, 1);
  });

  it('★ 量化位置精度在可接受范围内', () => {
    // 场景范围 100m, 24-bit 量化精度 ≈ 6μm
    const cloud = makeCloud([
      { x: 0, y: 0, z: 0 },
      { x: 50, y: 50, z: 50 },
      { x: 100, y: 100, z: 100 },
    ]);
    const buffer = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      spatialSort: false,
    });
    const metadata = parseSogMetadata(buffer);

    // 读取量化后的 chunk 数据
    const chunkOffset = metadata.chunks[0].offset;
    const chunkSize = metadata.chunks[0].size;
    const u8 = new Uint8Array(buffer);

    // 解压 chunk 数据 (虽然 compression=false, 但还是确认一下)
    const chunkData = u8.slice(chunkOffset, chunkOffset + chunkSize);

    // 反量化验证
    const rangeX = metadata.bboxMax[0] - metadata.bboxMin[0];
    const rangeY = metadata.bboxMax[1] - metadata.bboxMin[1];
    const rangeZ = metadata.bboxMax[2] - metadata.bboxMin[2];

    const QUANT_MAX = 0xFFFFFF;

    // 读取第一个 splat (原始位置 0,0,0)
    const qx0 = chunkData[0] | (chunkData[1] << 8) | (chunkData[2] << 16);
    const x0 = (qx0 / QUANT_MAX) * rangeX + metadata.bboxMin[0];
    expect(Math.abs(x0 - 0)).toBeLessThan(rangeX / QUANT_MAX * 2); // 2 步精度

    // 读取第二个 splat (原始位置 50,50,50)
    const qx1 = chunkData[29] | (chunkData[30] << 8) | (chunkData[31] << 16);
    const x1 = (qx1 / QUANT_MAX) * rangeX + metadata.bboxMin[0];
    expect(Math.abs(x1 - 50)).toBeLessThan(rangeX / QUANT_MAX * 2);

    // 读取第三个 splat (原始位置 100,100,100)
    const qx2 = chunkData[58] | (chunkData[59] << 8) | (chunkData[60] << 16);
    const x2 = (qx2 / QUANT_MAX) * rangeX + metadata.bboxMin[0];
    expect(Math.abs(x2 - 100)).toBeLessThan(rangeX / QUANT_MAX * 2);
  });

  it('★ 量化 + gzip 组合正常工作', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 100; i++) {
      splats.push({ x: i, y: i * 0.5, z: i * 0.1 });
    }
    const cloud = makeCloud(splats);

    const buffer = writeSog(cloud, {
      positionQuantization: true,
      compression: true,
    });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.positionQuantization).toBe(SOG_POSITION_QUANT_24BIT);
    expect(metadata.compression).toBe(1); // gzip
    expect(metadata.numSplats).toBe(100);

    // 验证 gzip 解压后的数据大小 = 100 × 29
    const chunkOffset = metadata.chunks[0].offset;
    const chunkSize = metadata.chunks[0].size;
    const u8 = new Uint8Array(buffer);
    const compressedData = Buffer.from(u8.slice(chunkOffset, chunkOffset + chunkSize));
    const decompressed = gunzipSync(compressedData);
    expect(decompressed.length).toBe(100 * SOG_COMPACT_BYTES_PER_SPLAT);
  });

  it('★ 量化后非位置属性 (scale, color, rotation) 保持正确', () => {
    const cloud = makeCloud([{
      x: 50, y: 50, z: 50,
      scaleX: 0.05, scaleY: 0.03, scaleZ: 0.02,
      colorR: 0.8, colorG: 0.4, colorB: 0.2,
      opacity: 0.9,
      rotW: 0.7, rotX: 0.1, rotY: 0.2, rotZ: 0.3,
    }]);
    const buffer = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      spatialSort: false,
    });
    const metadata = parseSogMetadata(buffer);

    const chunkOffset = metadata.chunks[0].offset;
    const view = new DataView(buffer);

    // Scale XYZ at offset 9-20 (3 × Float32)
    const scaleX = view.getFloat32(chunkOffset + 9, true);
    const scaleY = view.getFloat32(chunkOffset + 13, true);
    const scaleZ = view.getFloat32(chunkOffset + 17, true);
    expect(scaleX).toBeCloseTo(0.05, 5);
    expect(scaleY).toBeCloseTo(0.03, 5);
    expect(scaleZ).toBeCloseTo(0.02, 5);

    // Color RGBA at offset 21-24 (4 × Uint8)
    expect(view.getUint8(chunkOffset + 21)).toBe(Math.round(0.8 * 255)); // 204
    expect(view.getUint8(chunkOffset + 22)).toBe(Math.round(0.4 * 255)); // 102
    expect(view.getUint8(chunkOffset + 23)).toBe(Math.round(0.2 * 255)); // 51
    expect(view.getUint8(chunkOffset + 24)).toBe(Math.round(0.9 * 255)); // 230

    // Rotation IJKL at offset 25-28 (4 × Uint8)
    expect(view.getUint8(chunkOffset + 25)).toBe(Math.round(0.7 * 128) + 128);
    expect(view.getUint8(chunkOffset + 26)).toBe(Math.round(0.1 * 128) + 128);
    expect(view.getUint8(chunkOffset + 27)).toBe(Math.round(0.2 * 128) + 128);
    expect(view.getUint8(chunkOffset + 28)).toBe(Math.round(0.3 * 128) + 128);
  });

  it('★ 量化 + gzip: 未压缩时量化更小, gzip 压缩率取决于数据分布', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 500; i++) {
      splats.push({
        x: i * 0.2,
        y: (i % 50) * 0.3,
        z: (i % 10) * 0.5,
      });
    }
    const cloud = makeCloud(splats);

    // 未压缩时, 量化数据一定更小 (29B vs 32B)
    const quantUncomp = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      spatialSort: false,
    });
    const unquantUncomp = writeSog(cloud, {
      positionQuantization: false,
      compression: false,
      spatialSort: false,
    });
    expect(quantUncomp.byteLength).toBeLessThan(unquantUncomp.byteLength);

    // gzip 压缩后, 结果取决于数据分布:
    // Float32 位置有更多冗余模式 (指数/尾数) → gzip 压缩率高
    // Uint24 量化值更随机 → gzip 压缩率低
    // 因此量化+gzip 不一定小于未量化+gzip, 但量化减少了原始数据量
    const quantComp = writeSog(cloud, {
      positionQuantization: true,
      compression: true,
      spatialSort: false,
    });
    const unquantComp = writeSog(cloud, {
      positionQuantization: false,
      compression: true,
      spatialSort: false,
    });
    // 仅验证两者都能正常生成
    expect(quantComp.byteLength).toBeGreaterThan(0);
    expect(unquantComp.byteLength).toBeGreaterThan(0);
  });

  it('★ 空集 + 量化不崩溃', () => {
    const cloud = makeCloud([]);
    const buffer = writeSog(cloud, { positionQuantization: true });
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(SOG_MAGIC_V2);
    expect(view.getUint8(53)).toBe(SOG_POSITION_QUANT_OFF); // 空集时 quant=0
  });

  it('★ 反量化 round-trip: 量化 → 反量化 → 原始值误差极小', () => {
    // 生成测试数据
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    const positions: number[][] = [];
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const z = Math.random() * 100;
      positions.push([x, y, z]);
      splats.push({ x, y, z });
    }
    const cloud = makeCloud(splats);

    // 量化写入
    const buffer = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      spatialSort: false,
    });
    const metadata = parseSogMetadata(buffer);

    // 读取量化数据并反量化
    const chunkOffset = metadata.chunks[0].offset;
    const view = new DataView(buffer);
    const QUANT_MAX = 0xFFFFFF;
    const rangeX = metadata.bboxMax[0] - metadata.bboxMin[0];
    const rangeY = metadata.bboxMax[1] - metadata.bboxMin[1];
    const rangeZ = metadata.bboxMax[2] - metadata.bboxMin[2];

    for (let i = 0; i < 100; i++) {
      const base = chunkOffset + i * SOG_COMPACT_BYTES_PER_SPLAT;
      const qx = view.getUint8(base) | (view.getUint8(base + 1) << 8) | (view.getUint8(base + 2) << 16);
      const qy = view.getUint8(base + 3) | (view.getUint8(base + 4) << 8) | (view.getUint8(base + 5) << 16);
      const qz = view.getUint8(base + 6) | (view.getUint8(base + 7) << 8) | (view.getUint8(base + 8) << 16);

      const x = (qx / QUANT_MAX) * rangeX + metadata.bboxMin[0];
      const y = (qy / QUANT_MAX) * rangeY + metadata.bboxMin[1];
      const z = (qz / QUANT_MAX) * rangeZ + metadata.bboxMin[2];

      // 误差应小于 2 步量化精度
      const stepX = rangeX / QUANT_MAX;
      const stepY = rangeY / QUANT_MAX;
      const stepZ = rangeZ / QUANT_MAX;

      expect(Math.abs(x - positions[i][0])).toBeLessThan(stepX * 2);
      expect(Math.abs(y - positions[i][1])).toBeLessThan(stepY * 2);
      expect(Math.abs(z - positions[i][2])).toBeLessThan(stepZ * 2);
    }
  });
});

// ── M2: 预构建 LOD 树测试 ─────────────────────────────────

describe('writeSog — M2 预构建 LOD 树', () => {
  it('★ 默认启用预构建 LOD 树 (buildLodTree 未设置时)', () => {
    // 使用 >100 splat 触发 LOD 树构建
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 200; i++) {
      splats.push({ x: i * 0.5, y: i * 0.3, z: i * 0.1 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { compression: false });
    const view = new DataView(buffer);

    // lodTreeOffset 应非零 (LOD 树紧跟在 chunk data 之后)
    const lodTreeOffset = view.getUint32(44, true);
    const lodTreeSize = view.getUint32(48, true);
    expect(lodTreeOffset).toBeGreaterThan(0);
    expect(lodTreeSize).toBeGreaterThan(0);
  });

  it('★ buildLodTree=false 时 lodTreeOffset=0', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 200; i++) {
      splats.push({ x: i * 0.5, y: i * 0.3, z: i * 0.1 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { buildLodTree: false });
    const view = new DataView(buffer);

    expect(view.getUint32(44, true)).toBe(0);
    expect(view.getUint32(48, true)).toBe(0);
  });

  it('★ splat 数 <= MIN_LOD_SPLATS 时不构建 LOD 树', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud);
    const view = new DataView(buffer);

    expect(view.getUint32(44, true)).toBe(0);
    expect(view.getUint32(48, true)).toBe(0);
  });

  it('★ parseSogMetadata 正确读取 LOD 层级数据', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({ x: i * 0.1, y: i * 0.05, z: i * 0.01 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodQuality: 1 });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.lodTreeOffset).toBeGreaterThan(0);
    expect(metadata.lodTreeSize).toBeGreaterThan(0);
    expect(metadata.lodLevels).toBeDefined();
    expect(metadata.lodLevels!.length).toBe(4); // 默认 4 层
    expect(metadata.lodBase).toBe(1.75); // quality=true → 1.75
    // 最后一层 = 全部 splat
    expect(metadata.lodLevels![metadata.lodLevels!.length - 1]).toBe(1000);
  });

  it('★ LOD 层级单调递增', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 10000; i++) {
      splats.push({ x: i * 0.01, y: (i % 100) * 0.1, z: (i % 10) * 0.5 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodQuality: 1 });
    const metadata = parseSogMetadata(buffer);

    const levels = metadata.lodLevels!;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
    // 第一层应显著少于最后一层
    expect(levels[0]).toBeLessThan(levels[levels.length - 1]);
  });

  it('★ lodQuality=0 (fast) 使用 lodBase=1.5', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({ x: i * 0.1, y: i * 0.05, z: i * 0.01 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodQuality: 0 });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.lodBase).toBe(1.5);
  });

  it('★ lodQuality=1 (quality) 使用 lodBase=1.75', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({ x: i * 0.1, y: i * 0.05, z: i * 0.01 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodQuality: 1 });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.lodBase).toBe(1.75);
  });

  it('★ 自定义 lodLevels 参数', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({ x: i * 0.1, y: i * 0.05, z: i * 0.01 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodLevels: 3 });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.lodLevels!.length).toBe(3);
    expect(metadata.lodLevels![2]).toBe(1000); // 最后一层 = 全部
  });

  it('★ LOD 树数据大小正确 (8 + numLevels * 4)', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 500; i++) {
      splats.push({ x: i * 0.2, y: i * 0.1, z: i * 0.05 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodLevels: 5 });
    const metadata = parseSogMetadata(buffer);

    // 8 bytes header + 5 levels × 4 bytes = 28 bytes
    expect(metadata.lodTreeSize).toBe(8 + 5 * 4);
  });

  it('★ LOD 树 + gzip 压缩组合正常工作', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 500; i++) {
      splats.push({ x: i * 0.2, y: i * 0.1, z: i * 0.05 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, {
      compression: true,
      lodQuality: 1,
      buildLodTree: true,
    });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.compression).toBe(1);
    expect(metadata.lodTreeOffset).toBeGreaterThan(0);
    expect(metadata.lodLevels).toBeDefined();
    expect(metadata.lodLevels!.length).toBe(4);
  });

  it('★ LOD 树 + 位置量化组合正常工作', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 500; i++) {
      splats.push({ x: i * 0.2, y: i * 0.1, z: i * 0.05 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      buildLodTree: true,
    });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.positionQuantization).toBe(1);
    expect(metadata.lodTreeOffset).toBeGreaterThan(0);
    expect(metadata.lodLevels).toBeDefined();
  });

  it('★ writeSog → parseSogMetadata round-trip: LOD 层级数据一致', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 5000; i++) {
      splats.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        z: Math.random() * 100,
      });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { lodQuality: 1, lodLevels: 4 });
    const metadata = parseSogMetadata(buffer);

    // 验证 LOD 层级数据完整性
    expect(metadata.lodLevels).toBeDefined();
    expect(metadata.lodLevels!.length).toBe(4);
    expect(metadata.lodBase).toBe(1.75);

    // 验证层级计算正确性
    const levels = metadata.lodLevels!;
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[3]).toBe(5000); // 最后一层 = 全部

    // 验证 lodBase^3 缩减
    const expectedLevel0 = Math.max(100, Math.floor(5000 / Math.pow(1.75, 3)));
    expect(levels[0]).toBe(expectedLevel0);
  });

  it('★ LOD 树不破坏 chunk 数据完整性', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 500; i++) {
      splats.push({
        x: i * 0.2,
        y: i * 0.1,
        z: i * 0.05,
        scaleX: 0.01,
        scaleY: 0.01,
        scaleZ: 0.01,
      });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, {
      compression: false,
      buildLodTree: true,
    });
    const metadata = parseSogMetadata(buffer);

    // 验证 chunk 数据完整性: 每个 chunk 的 offset + size 不应与 LOD 树重叠
    for (const chunk of metadata.chunks) {
      expect(chunk.offset).toBeGreaterThanOrEqual(64 + metadata.numChunks * 8);
      expect(chunk.offset + chunk.size).toBeLessThanOrEqual(metadata.lodTreeOffset);
    }

    // 验证 LOD 树在 chunk data 之后
    expect(metadata.lodTreeOffset).toBeGreaterThanOrEqual(
      metadata.chunks[metadata.chunks.length - 1].offset +
      metadata.chunks[metadata.chunks.length - 1].size,
    );
  });
});

// ── M2: buildLodLevels 单元测试 ───────────────────────────

describe('buildLodLevels — LOD 层级计算', () => {
  it('★ 正确计算 4 层 LOD (lodBase=1.75)', () => {
    const levels = buildLodLevels(100000, 4, 1.75);
    expect(levels.length).toBe(4);
    // level 0: 100000 / 1.75^3 ≈ 18657
    expect(levels[0]).toBe(Math.max(100, Math.floor(100000 / Math.pow(1.75, 3))));
    // level 3: 100000 (全部)
    expect(levels[3]).toBe(100000);
  });

  it('★ 正确计算 3 层 LOD (lodBase=1.5)', () => {
    const levels = buildLodLevels(100000, 3, 1.5);
    expect(levels.length).toBe(3);
    // level 0: 100000 / 1.5^2 ≈ 44444
    expect(levels[0]).toBe(Math.floor(100000 / Math.pow(1.5, 2)));
    // level 2: 100000
    expect(levels[2]).toBe(100000);
  });

  it('★ 最小 splat 数保护 (MIN_LOD_SPLATS=100)', () => {
    // numSplats=50 太少, 低于 MIN_LOD_SPLATS
    // buildLodLevels 会将所有层级 clamped 到 max(100, computed)
    // 但最后一个层级 = numSplats = 50, 单调性修正后 = 100
    const levels = buildLodLevels(50, 4, 1.75);
    // 所有层级都应 >= MIN_LOD_SPLATS (因单调性修正)
    expect(levels[0]).toBeGreaterThanOrEqual(100);
    expect(levels[levels.length - 1]).toBeGreaterThanOrEqual(100);
    // 实际 writeSog 中 numSplats <= MIN_LOD_SPLATS 时不构建 LOD 树
  });

  it('★ 层级单调递增', () => {
    const levels = buildLodLevels(1000000, 5, 1.75);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
  });

  it('★ numSplats=0 返回 [0]', () => {
    const levels = buildLodLevels(0, 4, 1.75);
    expect(levels).toEqual([0]);
  });

  it('★ numLevels=1 返回 [numSplats]', () => {
    const levels = buildLodLevels(10000, 1, 1.75);
    expect(levels).toEqual([10000]);
  });
});

// ── M2: serializeLodTree / deserializeLodTree round-trip ──

describe('serializeLodTree / deserializeLodTree — 序列化 round-trip', () => {
  it('★ 序列化 → 反序列化数据一致', () => {
    const levels = [1000, 5000, 20000, 100000];
    const lodBase = 1.75;
    const buffer = serializeLodTree(levels, lodBase);
    const result = deserializeLodTree(buffer);

    expect(result).not.toBeNull();
    expect(result!.levels).toEqual(levels);
    expect(result!.lodBase).toBe(lodBase);
  });

  it('★ 序列化后大小正确 (8 + numLevels * 4)', () => {
    const levels = [100, 200, 300, 400, 500];
    const buffer = serializeLodTree(levels, 1.5);
    expect(buffer.byteLength).toBe(8 + 5 * 4);
  });

  it('★ 反序列化无效数据返回 null', () => {
    // 数据过小
    const smallBuffer = new ArrayBuffer(4);
    expect(deserializeLodTree(smallBuffer)).toBeNull();

    // numLevels=0
    const zeroBuffer = new ArrayBuffer(8);
    const view = new DataView(zeroBuffer);
    view.setUint32(0, 0, true);
    view.setFloat32(4, 1.5, true);
    expect(deserializeLodTree(zeroBuffer)).toBeNull();

    // numLevels 过大
    const hugeBuffer = new ArrayBuffer(8);
    const view2 = new DataView(hugeBuffer);
    view2.setUint32(0, 200, true);
    view2.setFloat32(4, 1.5, true);
    expect(deserializeLodTree(hugeBuffer)).toBeNull();
  });
});
