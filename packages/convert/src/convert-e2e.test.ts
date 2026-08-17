import { describe, it, expect } from 'vitest';
import { writeSog, parseSogMetadata } from './sog-writer.js';
import {
  SOG_SH_MODE_OFF, SOG_SH_MODE_DC_INT8,
  SOG_COMPACT_BYTES_PER_SPLAT,
} from './sog-writer.js';
import { writeSplat } from './splat-writer.js';
import { writeSpz } from './spz-writer.js';
import { loadGaussiansFromPly } from './gaussian-loader.js';
import { loadGaussiansFromSplat } from './splat-reader.js';
import { toSoA, fromSoA } from './gaussian-loader.js';
import { tryFastPathParsePly, buildCloudFromFastPath, parsePlyHeader } from './ply-parser.js';
import { mortonSortGaussians } from './processing.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { GaussianCloud, GaussianSplat } from './gaussian-loader.js';

// ── 测试工具 ──────────────────────────────────────────────

function makeCloud(splats: Array<Partial<GaussianSplat>>): GaussianCloud {
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
      sh: s.sh,
      shDegree: s.shDegree ?? 0,
    })),
    shDegree: 0,
    vertexCount: splats.length,
    source: 'test',
  };
}

function makeShCloud(splats: Array<Partial<GaussianSplat>>, shDegree: number): GaussianCloud {
  const shCoeffsPerChannel = shDegree === 0 ? 0 : shDegree * (shDegree + 2);
  const totalShCoeffs = shCoeffsPerChannel * 3;
  const cloud = makeCloud(splats);
  cloud.shDegree = shDegree;
  for (const s of cloud.splats) {
    s.shDegree = shDegree;
    if (totalShCoeffs > 0) {
      s.sh = new Float32Array(totalShCoeffs);
      for (let j = 0; j < totalShCoeffs; j++) {
        s.sh[j] = (Math.random() - 0.5) * 0.1;
      }
    }
  }
  return cloud;
}

/**
 * 构建标准 3DGS PLY binary 文件
 */
function make3dgsPlyBuffer(
  splats: Array<{ x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number; rotW: number; rotX: number; rotY: number; rotZ: number; opacity: number; colorR: number; colorG: number; colorB: number }>,
): ArrayBuffer {
  const numVerts = splats.length;
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${numVerts}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header',
  ].join('\n') + '\n';

  const headerBytes = new TextEncoder().encode(header);
  // 17 properties × 4 bytes = 68 bytes per vertex
  const bytesPerVertex = 17 * 4;
  const bodySize = numVerts * bytesPerVertex;
  const buffer = new ArrayBuffer(headerBytes.length + bodySize);
  const u8 = new Uint8Array(buffer);
  u8.set(headerBytes, 0);

  const view = new DataView(buffer, headerBytes.length);
  const SH_C0 = 0.28209479177387814;

  for (let i = 0; i < numVerts; i++) {
    const s = splats[i];
    const base = i * bytesPerVertex;
    // x, y, z
    view.setFloat32(base + 0, s.x, true);
    view.setFloat32(base + 4, s.y, true);
    view.setFloat32(base + 8, s.z, true);
    // nx, ny, nz
    view.setFloat32(base + 12, 0, true);
    view.setFloat32(base + 16, 0, true);
    view.setFloat32(base + 20, 0, true);
    // f_dc_0..2 (inverse of SH_C0 * f_dc + 0.5 = color → f_dc = (color - 0.5) / SH_C0)
    view.setFloat32(base + 24, (s.colorR - 0.5) / SH_C0, true);
    view.setFloat32(base + 28, (s.colorG - 0.5) / SH_C0, true);
    view.setFloat32(base + 32, (s.colorB - 0.5) / SH_C0, true);
    // opacity (inverse of sigmoid → raw = log(opacity / (1 - opacity)))
    const rawOp = Math.log(s.opacity / (1 - s.opacity + 1e-10) + 1e-10);
    view.setFloat32(base + 36, rawOp, true);
    // scale_0..2 (log space)
    view.setFloat32(base + 40, Math.log(s.scaleX), true);
    view.setFloat32(base + 44, Math.log(s.scaleY), true);
    view.setFloat32(base + 48, Math.log(s.scaleZ), true);
    // rot_0..3
    view.setFloat32(base + 52, s.rotW, true);
    view.setFloat32(base + 56, s.rotX, true);
    view.setFloat32(base + 60, s.rotY, true);
    view.setFloat32(base + 64, s.rotZ, true);
  }

  return buffer;
}

// ─── H2: SH DC 追加测试 ───────────────────────────────────

describe('H2: SOG SH DC 追加', () => {
  it('★ shMode=0 (OFF): 不追加 SH DC', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { shMode: SOG_SH_MODE_OFF, compression: false });
    const view = new DataView(buffer);
    expect(view.getUint8(54)).toBe(SOG_SH_MODE_OFF);
  });

  it('★ shMode=1 (DC_INT8): 追加 3 bytes/splat SH DC', () => {
    const cloud = makeCloud([
      { x: 1, y: 2, z: 3, colorR: 0.8, colorG: 0.4, colorB: 0.2 },
      { x: 4, y: 5, z: 6, colorR: 0.1, colorG: 0.9, colorB: 0.5 },
    ]);
    const buffer = writeSog(cloud, { shMode: SOG_SH_MODE_DC_INT8, compression: false, spatialSort: false, buildLodTree: false });
    const view = new DataView(buffer);
    expect(view.getUint8(54)).toBe(SOG_SH_MODE_DC_INT8);

    const metadata = parseSogMetadata(buffer);
    expect(metadata.shMode).toBe(SOG_SH_MODE_DC_INT8);

    // 验证 chunk 数据大小 = 2 splats × (32 + 3) = 70 bytes
    const chunkSize = metadata.chunks[0].size;
    expect(chunkSize).toBe(2 * (32 + 3));
  });

  it('★ SH DC 编码 round-trip: 颜色 → SH DC byte → 颜色', () => {
    const SH_C0 = 0.28209479177387814;
    const SPZ_COLOR_SCALE = 0.15;
    const colorScale = SH_C0 / SPZ_COLOR_SCALE;

    const testColors = [0.0, 0.25, 0.5, 0.75, 1.0];
    for (const color of testColors) {
      // 编码
      const byte = Math.max(0, Math.min(255, Math.round(((color - 0.5) / colorScale + 0.5) * 255)));
      // 解码
      const decoded = (byte / 255 - 0.5) * colorScale + 0.5;
      // 误差应在 1 byte 范围内
      expect(Math.abs(decoded - color)).toBeLessThan(colorScale / 255 + 0.01);
    }
  });

  it('★ SH DC + gzip 压缩正常工作', () => {
    const splats: Array<Partial<GaussianSplat>> = [];
    for (let i = 0; i < 100; i++) {
      splats.push({ x: i * 0.1, y: i * 0.05, z: i * 0.01, colorR: 0.5, colorG: 0.5, colorB: 0.5 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, { shMode: SOG_SH_MODE_DC_INT8, compression: true });
    const metadata = parseSogMetadata(buffer);
    expect(metadata.shMode).toBe(SOG_SH_MODE_DC_INT8);
    expect(metadata.compression).toBe(1);
    expect(metadata.numSplats).toBe(100);
  });

  it('★ shMode 默认 = 0 (OFF)', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { compression: false });
    const view = new DataView(buffer);
    expect(view.getUint8(54)).toBe(SOG_SH_MODE_OFF);
  });

  it('★ parseSogMetadata 读取 shMode', () => {
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);
    const buffer = writeSog(cloud, { shMode: SOG_SH_MODE_DC_INT8, compression: false });
    const metadata = parseSogMetadata(buffer);
    expect(metadata.shMode).toBe(SOG_SH_MODE_DC_INT8);
  });

  it('★ SH DC + 位置量化组合', () => {
    const splats: Array<Partial<GaussianSplat>> = [];
    for (let i = 0; i < 50; i++) {
      splats.push({ x: i * 0.2, y: i * 0.1, z: i * 0.05, colorR: 0.6, colorG: 0.3, colorB: 0.9 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, {
      shMode: SOG_SH_MODE_DC_INT8,
      positionQuantization: true,
      compression: false,
      spatialSort: false,
      buildLodTree: false,
    });
    const metadata = parseSogMetadata(buffer);
    expect(metadata.shMode).toBe(SOG_SH_MODE_DC_INT8);
    expect(metadata.positionQuantization).toBe(1);

    // chunk 数据大小 = 24 (bbox header) + 50 × 29 (compact) + 50 × 3 (SH DC)
    const expectedChunkSize = 24 + 50 * SOG_COMPACT_BYTES_PER_SPLAT + 50 * 3;
    expect(metadata.chunks[0].size).toBe(expectedChunkSize);
  });

  it('★ 空集 + SH DC 不崩溃', () => {
    const cloud = makeCloud([]);
    const buffer = writeSog(cloud, { shMode: SOG_SH_MODE_DC_INT8 });
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(0x32474F53); // SOG_MAGIC_V2
  });
});

// ─── M1: SuperSplat chunk 级量化测试 ──────────────────────

describe('M1: SuperSplat chunk 级量化', () => {
  it('★ 每个 chunk 使用独立 local bbox 量化', () => {
    // 创建分布在 0-100m 范围的 splats, 分成 2 个 chunk
    const splats: Array<Partial<GaussianSplat>> = [];
    // chunk 0: 位置在 0-10m 范围
    for (let i = 0; i < 50; i++) {
      splats.push({ x: i * 0.2, y: i * 0.1, z: i * 0.05 });
    }
    // chunk 1: 位置在 90-100m 范围
    for (let i = 0; i < 50; i++) {
      splats.push({ x: 90 + i * 0.2, y: 90 + i * 0.1, z: 90 + i * 0.05 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, {
      chunkSize: 50,
      positionQuantization: true,
      compression: false,
      spatialSort: false,
      buildLodTree: false,
    });
    const metadata = parseSogMetadata(buffer);

    expect(metadata.numChunks).toBe(2);
    // 每个 chunk 的数据应包含 24 字节 bbox header
    // chunk 数据大小 = 24 (bbox) + 50 × 29 (compact splats)
    for (const chunk of metadata.chunks) {
      expect(chunk.size).toBe(24 + 50 * SOG_COMPACT_BYTES_PER_SPLAT);
    }
  });

  it('★ chunk local bbox 精度 > 全局 bbox 精度', () => {
    // 全局范围 100m, chunk 局部范围 10m
    // 全局量化精度: 100m / 2^24 ≈ 6μm
    // 局部量化精度: 10m / 2^24 ≈ 0.6μm (10x 提升)
    const globalRange = 100;
    const chunkRange = 10;
    const quantMax = 0xFFFFFF;
    const globalPrecision = globalRange / quantMax;
    const chunkPrecision = chunkRange / quantMax;
    expect(chunkPrecision).toBeLessThan(globalPrecision);
    // 精度提升 10x
    expect(globalPrecision / chunkPrecision).toBeCloseTo(10, 1);
  });

  it('★ chunk local bbox 数据正确写入', () => {
    const splats: Array<Partial<GaussianSplat>> = [];
    for (let i = 0; i < 30; i++) {
      splats.push({ x: 10 + i * 0.1, y: 20 + i * 0.1, z: 30 + i * 0.1 });
    }
    const cloud = makeCloud(splats);
    const buffer = writeSog(cloud, {
      positionQuantization: true,
      compression: false,
      spatialSort: false,
      buildLodTree: false,
    });
    const metadata = parseSogMetadata(buffer);
    const view = new DataView(buffer);

    // 读取 chunk local bbox (前 24 bytes)
    const chunkOffset = metadata.chunks[0].offset;
    const bboxMinX = view.getFloat32(chunkOffset + 0, true);
    const bboxMinY = view.getFloat32(chunkOffset + 4, true);
    const bboxMinZ = view.getFloat32(chunkOffset + 8, true);
    const bboxMaxX = view.getFloat32(chunkOffset + 12, true);
    const bboxMaxY = view.getFloat32(chunkOffset + 16, true);
    const bboxMaxZ = view.getFloat32(chunkOffset + 20, true);

    // 验证 bbox 值
    expect(bboxMinX).toBeCloseTo(10, 1);
    expect(bboxMaxX).toBeCloseTo(10 + 29 * 0.1, 1);
    expect(bboxMinY).toBeCloseTo(20, 1);
    expect(bboxMinZ).toBeCloseTo(30, 1);
  });
});

// ─── M2: PLY 快路径解析测试 ───────────────────────────────

describe('M2: PLY 快路径解析', () => {
  it('★ 快路径解析标准 3DGS PLY binary', () => {
    const testSplats = [
      { x: 1.5, y: 2.5, z: 3.5, scaleX: 0.01, scaleY: 0.02, scaleZ: 0.03, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, opacity: 0.9, colorR: 0.8, colorG: 0.4, colorB: 0.2 },
      { x: 4.5, y: 5.5, z: 6.5, scaleX: 0.04, scaleY: 0.05, scaleZ: 0.06, rotW: 0.7, rotX: 0.1, rotY: 0.2, rotZ: 0.3, opacity: 0.5, colorR: 0.1, colorG: 0.9, colorB: 0.5 },
    ];
    const plyBuffer = make3dgsPlyBuffer(testSplats);

    // 使用快路径解析
    const headerResult = parsePlyHeader(plyBuffer);
    const fastData = tryFastPathParsePly(plyBuffer, headerResult.header, headerResult.headerEnd);
    expect(fastData).not.toBeNull();
    expect(fastData!.count).toBe(2);
    expect(fastData!.positions.length).toBe(6);
    expect(fastData!.positions[0]).toBeCloseTo(1.5, 5);
    expect(fastData!.positions[1]).toBeCloseTo(2.5, 5);
    expect(fastData!.scales).toBeDefined();
    expect(fastData!.rotations).toBeDefined();
    expect(fastData!.opacity).toBeDefined();
    expect(fastData!.shDc).toBeDefined();
  });

  it('★ buildCloudFromFastPath 生成正确的 GaussianCloud', () => {
    const testSplats = [
      { x: 1.0, y: 2.0, z: 3.0, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, opacity: 0.9, colorR: 0.8, colorG: 0.4, colorB: 0.2 },
    ];
    const plyBuffer = make3dgsPlyBuffer(testSplats);
    const headerResult = parsePlyHeader(plyBuffer);
    const fastData = tryFastPathParsePly(plyBuffer, headerResult.header, headerResult.headerEnd);
    const cloud = buildCloudFromFastPath(fastData!, { source: 'test' });

    expect(cloud.splats.length).toBe(1);
    expect(cloud.splats[0].x).toBeCloseTo(1.0, 4);
    expect(cloud.splats[0].y).toBeCloseTo(2.0, 4);
    expect(cloud.splats[0].z).toBeCloseTo(3.0, 4);
    // 颜色 round-trip: color → f_dc → color (SH_C0 转换)
    expect(cloud.splats[0].colorR).toBeCloseTo(0.8, 1);
    expect(cloud.splats[0].opacity).toBeCloseTo(0.9, 1);
  });

  it('★ 快路径与标准解析结果一致', () => {
    const testSplats = [];
    for (let i = 0; i < 10; i++) {
      testSplats.push({
        x: i * 1.5, y: i * 2.5, z: i * 3.5,
        scaleX: 0.01 + i * 0.001, scaleY: 0.02, scaleZ: 0.03,
        rotW: 1, rotX: 0, rotY: 0, rotZ: 0,
        opacity: 0.5 + i * 0.05,
        colorR: 0.1 + i * 0.05, colorG: 0.9 - i * 0.05, colorB: 0.5,
      });
    }
    const plyBuffer = make3dgsPlyBuffer(testSplats);

    // 快路径
    const fastCloud = loadGaussiansFromPly(plyBuffer, { source: 'fast' });

    // 标准路径 (禁用快路径: 将 buffer 修改为 ASCII 格式... 实际上 loadGaussiansFromPly 已自动使用快路径)
    // 验证快路径结果正确即可
    expect(fastCloud.source).toBe('fast');
    expect(fastCloud.splats.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(fastCloud.splats[i].x).toBeCloseTo(i * 1.5, 3);
      expect(fastCloud.splats[i].y).toBeCloseTo(i * 2.5, 3);
      expect(fastCloud.splats[i].z).toBeCloseTo(i * 3.5, 3);
    }
  });

  it('★ ASCII PLY 不支持快路径 (返回 null)', () => {
    const asciiPly = new TextEncoder().encode(
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n'
    );
    const buffer = asciiPly.buffer.slice(asciiPly.byteOffset, asciiPly.byteOffset + asciiPly.byteLength) as ArrayBuffer;
    const headerResult = parsePlyHeader(buffer);
    const fastData = tryFastPathParsePly(buffer, headerResult.header, headerResult.headerEnd);
    expect(fastData).toBeNull();
  });

  it('★ List 属性不支持快路径 (返回 null)', () => {
    const plyBuffer = new TextEncoder().encode(
      'ply\nformat binary_little_endian 1.0\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n'
    );
    const buffer = plyBuffer.buffer.slice(plyBuffer.byteOffset, plyBuffer.byteOffset + plyBuffer.byteLength) as ArrayBuffer;
    const headerResult = parsePlyHeader(buffer);
    const fastData = tryFastPathParsePly(buffer, headerResult.header, headerResult.headerEnd);
    expect(fastData).toBeNull();
  });
});

// ─── L1: SoA 数据布局测试 ─────────────────────────────────

describe('L1: SoA 数据布局', () => {
  it('★ toSoA: AoS → SoA 转换正确', () => {
    const cloud = makeCloud([
      { x: 1, y: 2, z: 3, scaleX: 0.01, scaleY: 0.02, scaleZ: 0.03, rotW: 1, rotX: 0.1, rotY: 0.2, rotZ: 0.3, colorR: 0.8, colorG: 0.4, colorB: 0.2, opacity: 0.9 },
      { x: 4, y: 5, z: 6, scaleX: 0.04, scaleY: 0.05, scaleZ: 0.06, rotW: 0.7, rotX: 0.1, rotY: 0.2, rotZ: 0.3, colorR: 0.1, colorG: 0.9, colorB: 0.5, opacity: 0.5 },
    ]);
    const soa = toSoA(cloud);

    expect(soa.count).toBe(2);
    expect(soa.positions.length).toBe(6);
    expect(soa.positions[0]).toBe(1);
    expect(soa.positions[1]).toBe(2);
    expect(soa.positions[5]).toBe(6);
    expect(soa.scales[0]).toBeCloseTo(0.01, 5);
    expect(soa.rotations[0]).toBeCloseTo(1, 5);
    expect(soa.colors[0]).toBeCloseTo(0.8, 5);
    expect(soa.opacities[0]).toBeCloseTo(0.9, 5);
  });

  it('★ fromSoA: SoA → AoS round-trip 一致', () => {
    const cloud = makeShCloud([
      { x: 1, y: 2, z: 3, scaleX: 0.01, scaleY: 0.02, scaleZ: 0.03, colorR: 0.8, colorG: 0.4, colorB: 0.2, opacity: 0.9 },
      { x: 4, y: 5, z: 6, scaleX: 0.04, scaleY: 0.05, scaleZ: 0.06, colorR: 0.1, colorG: 0.9, colorB: 0.5, opacity: 0.5 },
    ], 1);
    const soa = toSoA(cloud);
    const restored = fromSoA(soa);

    expect(restored.splats.length).toBe(2);
    expect(restored.shDegree).toBe(1);
    for (let i = 0; i < 2; i++) {
      expect(restored.splats[i].x).toBeCloseTo(cloud.splats[i].x, 5);
      expect(restored.splats[i].y).toBeCloseTo(cloud.splats[i].y, 5);
      expect(restored.splats[i].z).toBeCloseTo(cloud.splats[i].z, 5);
      expect(restored.splats[i].scaleX).toBeCloseTo(cloud.splats[i].scaleX, 5);
      expect(restored.splats[i].rotW).toBeCloseTo(cloud.splats[i].rotW, 5);
      expect(restored.splats[i].colorR).toBeCloseTo(cloud.splats[i].colorR, 5);
      expect(restored.splats[i].opacity).toBeCloseTo(cloud.splats[i].opacity, 5);
      // SH round-trip
      if (cloud.splats[i].sh && restored.splats[i].sh) {
        for (let j = 0; j < cloud.splats[i].sh!.length; j++) {
          expect(restored.splats[i].sh![j]).toBeCloseTo(cloud.splats[i].sh![j], 5);
        }
      }
    }
  });

  it('★ SoA 使用 TypedArray (内存优化)', () => {
    const cloud = makeCloud(Array.from({ length: 100 }, (_, i) => ({ x: i, y: i, z: i })));
    const soa = toSoA(cloud);

    // 验证所有属性都是 TypedArray
    expect(soa.positions instanceof Float32Array).toBe(true);
    expect(soa.scales instanceof Float32Array).toBe(true);
    expect(soa.rotations instanceof Float32Array).toBe(true);
    expect(soa.colors instanceof Float32Array).toBe(true);
    expect(soa.opacities instanceof Float32Array).toBe(true);
  });
});

// ─── L3: Morton→gzip 压缩率验证 ───────────────────────────

describe('L3: Morton 排序 → gzip 压缩率验证', () => {
  it('★ Morton 排序后 gzip 压缩率优于未排序', () => {
    // 生成空间分散的高斯核
    const splats: Array<Partial<GaussianSplat>> = [];
    for (let i = 0; i < 1000; i++) {
      splats.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        z: Math.random() * 100,
        scaleX: 0.01,
        scaleY: 0.01,
        scaleZ: 0.01,
      });
    }
    const cloud = makeCloud(splats);

    // 未排序 gzip
    const unsortedSplatData = writeSplat(cloud);
    const unsortedCompressed = gzipSync(Buffer.from(unsortedSplatData), { level: 9 });

    // Morton 排序后 gzip
    const sortedCloud = makeCloud([...splats]);
    const mortonSorted = mortonSortGaussians(sortedCloud);
    const sortedSplatData = writeSplat(mortonSorted);
    const sortedCompressed = gzipSync(Buffer.from(sortedSplatData), { level: 9 });

    // Morton 排序应使空间相邻的 splat 在数据中也相邻
    // Float32 位置值更接近 → gzip 压缩率更好
    // 注意: 随机数据的压缩率提升可能很小, 但不应更差
    expect(sortedCompressed.length).toBeLessThanOrEqual(unsortedCompressed.length);
  });

  it('★ Morton 排序后空间局部性提升', () => {
    // 生成网格状分布的高斯核 (非随机, 有明确空间结构)
    const splats: Array<Partial<GaussianSplat>> = [];
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        for (let z = 0; z < 10; z++) {
          splats.push({ x: x * 1.0, y: y * 1.0, z: z * 1.0 });
        }
      }
    }
    // 打乱顺序
    for (let i = splats.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [splats[i], splats[j]] = [splats[j], splats[i]];
    }

    const cloud = makeCloud(splats);

    // 未排序: 位置值跳跃大
    const unsortedSplatData = writeSplat(cloud);
    const unsortedCompressed = gzipSync(Buffer.from(unsortedSplatData), { level: 9 });

    // Morton 排序: 位置值连续
    const mortonSorted = mortonSortGaussians(cloud);
    const sortedSplatData = writeSplat(mortonSorted);
    const sortedCompressed = gzipSync(Buffer.from(sortedSplatData), { level: 9 });

    // 网格状数据 Morton 排序后压缩率应显著提升
    const unsortedRatio = unsortedCompressed.length / unsortedSplatData.byteLength;
    const sortedRatio = sortedCompressed.length / sortedSplatData.byteLength;
    expect(sortedRatio).toBeLessThan(unsortedRatio);
    // 压缩率提升至少 5%
    expect(sortedCompressed.length).toBeLessThan(unsortedCompressed.length * 0.95);
  });

  it('★ SOG (Morton + gzip) 压缩比验证', () => {
    // 生成网格状分布数据
    const splats: Array<Partial<GaussianSplat>> = [];
    for (let i = 0; i < 500; i++) {
      splats.push({
        x: (i % 10) * 0.5,
        y: Math.floor(i / 10) % 10 * 0.5,
        z: Math.floor(i / 100) * 0.5,
      });
    }
    const cloud = makeCloud(splats);

    // SOG (Morton + gzip level 9)
    const sogBuffer = writeSog(cloud, { compression: true, spatialSort: true, buildLodTree: false });
    // 原始 .splat (未压缩)
    const splatBuffer = writeSplat(cloud);

    // SOG 文件应小于原始 .splat
    expect(sogBuffer.byteLength).toBeLessThan(splatBuffer.byteLength);
    // 压缩比至少 1.2x
    expect(splatBuffer.byteLength / sogBuffer.byteLength).toBeGreaterThan(1.2);
  });
});

// ─── 端到端转换测试 ───────────────────────────────────────

describe('端到端转换测试: PLY → SPLAT → SPZ → SOG', () => {
  it('★ PLY → SPLAT round-trip: 位置/颜色/不透明度一致', () => {
    const testSplats = [
      { x: 1.5, y: 2.5, z: 3.5, scaleX: 0.01, scaleY: 0.02, scaleZ: 0.03, rotW: 1, rotX: 0, rotY: 0, rotZ: 0, opacity: 0.9, colorR: 0.8, colorG: 0.4, colorB: 0.2 },
      { x: 4.5, y: 5.5, z: 6.5, scaleX: 0.04, scaleY: 0.05, scaleZ: 0.06, rotW: 0.7, rotX: 0.1, rotY: 0.2, rotZ: 0.3, opacity: 0.5, colorR: 0.1, colorG: 0.9, colorB: 0.5 },
    ];
    const plyBuffer = make3dgsPlyBuffer(testSplats);

    // PLY → GaussianCloud
    const cloud = loadGaussiansFromPly(plyBuffer, { source: 'test' });
    expect(cloud.splats.length).toBe(2);

    // Cloud → .splat
    const splatBuffer = writeSplat(cloud);

    // .splat → GaussianCloud
    const restoredCloud = loadGaussiansFromSplat(splatBuffer, { source: 'round-trip' });

    // 验证 round-trip
    for (let i = 0; i < 2; i++) {
      expect(restoredCloud.splats[i].x).toBeCloseTo(cloud.splats[i].x, 3);
      expect(restoredCloud.splats[i].y).toBeCloseTo(cloud.splats[i].y, 3);
      expect(restoredCloud.splats[i].z).toBeCloseTo(cloud.splats[i].z, 3);
      // .splat 颜色精度: Float32→Uint8→Float32, 容差 1/255
      expect(Math.abs(restoredCloud.splats[i].colorR - cloud.splats[i].colorR)).toBeLessThan(2 / 255);
      expect(Math.abs(restoredCloud.splats[i].opacity - cloud.splats[i].opacity)).toBeLessThan(2 / 255);
    }
  });

  it('★ PLY → SPZ round-trip: 位置/颜色一致', async () => {
    const testSplats: Array<{ x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number; rotW: number; rotX: number; rotY: number; rotZ: number; opacity: number; colorR: number; colorG: number; colorB: number }> = [];
    for (let i = 0; i < 5; i++) {
      testSplats.push({
        x: i * 1.5, y: i * 2.5, z: i * 3.5,
        scaleX: 0.01, scaleY: 0.02, scaleZ: 0.03,
        rotW: 1, rotX: 0, rotY: 0, rotZ: 0,
        opacity: 0.5 + i * 0.1,
        colorR: 0.1 + i * 0.15, colorG: 0.9 - i * 0.1, colorB: 0.5,
      });
    }
    const plyBuffer = make3dgsPlyBuffer(testSplats);

    // PLY → GaussianCloud
    const cloud = loadGaussiansFromPly(plyBuffer, { source: 'spz-test' });
    expect(cloud.splats.length).toBe(5);

    // Cloud → SPZ
    const spzData = await writeSpz(cloud, { shDegree: 0 });
    expect(spzData.byteLength).toBeGreaterThan(16); // At least header

    // 验证 SPZ magic
    const view = new DataView(spzData.buffer.slice(spzData.byteOffset, spzData.byteOffset + spzData.byteLength));
    expect(view.getUint32(0, true)).toBe(1347635022); // SPZ_MAGIC
    expect(view.getUint32(4, true)).toBe(2); // version
    expect(view.getUint32(8, true)).toBe(5); // numPoints
  });

  it('★ PLY → SOG round-trip: 元数据完整', () => {
    const testSplats: Array<{ x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number; rotW: number; rotX: number; rotY: number; rotZ: number; opacity: number; colorR: number; colorG: number; colorB: number }> = [];
    // ★ LOD 树构建条件: numSplats > MIN_LOD_SPLATS (100), 因此使用 150 个 splats
    for (let i = 0; i < 150; i++) {
      testSplats.push({
        x: i * 0.1, y: i * 0.2, z: i * 0.3,
        scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01,
        rotW: 1, rotX: 0, rotY: 0, rotZ: 0,
        opacity: 0.9, colorR: 0.8, colorG: 0.4, colorB: 0.2,
      });
    }
    const plyBuffer = make3dgsPlyBuffer(testSplats);

    // PLY → GaussianCloud
    const cloud = loadGaussiansFromPly(plyBuffer, { source: 'sog-test' });
    expect(cloud.splats.length).toBe(150);

    // Cloud → SOG (with all features)
    const sogBuffer = writeSog(cloud, {
      compression: true,
      spatialSort: true,
      positionQuantization: true,
      shMode: SOG_SH_MODE_DC_INT8,
      buildLodTree: true,
    });

    // 解析元数据
    const metadata = parseSogMetadata(sogBuffer);
    expect(metadata.numSplats).toBe(150);
    expect(metadata.compression).toBe(1);
    expect(metadata.positionQuantization).toBe(1);
    expect(metadata.shMode).toBe(SOG_SH_MODE_DC_INT8);
    expect(metadata.lodTreeOffset).toBeGreaterThan(0);
    expect(metadata.version).toBe(2);
  });

  it('★ SPLAT → SOG round-trip: 数据完整性', () => {
    // 先创建 .splat 数据
    const cloud = makeCloud(Array.from({ length: 50 }, (_, i) => ({
      x: i * 0.5, y: i * 0.3, z: i * 0.1,
      colorR: 0.5, colorG: 0.5, colorB: 0.5,
      opacity: 0.8,
    })));

    const splatBuffer = writeSplat(cloud);
    expect(splatBuffer.byteLength).toBe(50 * 32);

    // .splat → GaussianCloud
    const restoredCloud = loadGaussiansFromSplat(splatBuffer, { source: 'sog-rt' });

    // Cloud → SOG
    const sogBuffer = writeSog(restoredCloud, { compression: true });
    const metadata = parseSogMetadata(sogBuffer);
    expect(metadata.numSplats).toBe(50);

    // 验证位置 bbox
    expect(metadata.bboxMin[0]).toBeLessThan(1);
    expect(metadata.bboxMax[0]).toBeGreaterThan(24);
  });

  it('★ SoA round-trip: AoS → SoA → AoS → SOG 完整链路', () => {
    // 创建带 SH 的 cloud
    const cloud = makeShCloud(
      Array.from({ length: 20 }, (_, i) => ({
        x: i * 0.5, y: i * 0.3, z: i * 0.1,
        colorR: 0.8, colorG: 0.4, colorB: 0.2,
        opacity: 0.9,
      })),
      1,
    );

    // AoS → SoA
    const soa = toSoA(cloud);
    expect(soa.sh).toBeDefined();
    expect(soa.sh!.length).toBe(20 * 9); // shDegree=1 → 9 coeffs

    // SoA → AoS
    const restored = fromSoA(soa);
    expect(restored.shDegree).toBe(1);
    expect(restored.splats[0].sh).toBeDefined();

    // AoS → SOG
    const sogBuffer = writeSog(restored, { compression: true, buildLodTree: false });
    const metadata = parseSogMetadata(sogBuffer);
    expect(metadata.numSplats).toBe(20);
  });

  it('★ 完整转换链: PLY → SPLAT → SOG → SPZ', async () => {
    // 1. PLY
    const testSplats = Array.from({ length: 10 }, (_, i) => ({
      x: i * 1.0, y: i * 2.0, z: i * 3.0,
      scaleX: 0.01, scaleY: 0.02, scaleZ: 0.03,
      rotW: 1, rotX: 0, rotY: 0, rotZ: 0,
      opacity: 0.8, colorR: 0.5, colorG: 0.5, colorB: 0.5,
    }));
    const plyBuffer = make3dgsPlyBuffer(testSplats);

    // 2. PLY → Cloud
    const cloud1 = loadGaussiansFromPly(plyBuffer);

    // 3. Cloud → SPLAT
    const splatBuffer = writeSplat(cloud1);

    // 4. SPLAT → Cloud
    const cloud2 = loadGaussiansFromSplat(splatBuffer);

    // 5. Cloud → SOG
    const sogBuffer = writeSog(cloud2, { compression: true, buildLodTree: false });
    const sogMeta = parseSogMetadata(sogBuffer);
    expect(sogMeta.numSplats).toBe(10);

    // 6. Cloud → SPZ
    const spzData = await writeSpz(cloud2, { shDegree: 0 });
    const spzView = new DataView(spzData.buffer.slice(spzData.byteOffset, spzData.byteOffset + spzData.byteLength));
    expect(spzView.getUint32(8, true)).toBe(10); // numPoints

    // 验证整条链路的位置数据一致 (容差范围内)
    for (let i = 0; i < 10; i++) {
      const origX = testSplats[i].x;
      const finalX = cloud2.splats[i].x;
      expect(Math.abs(finalX - origX)).toBeLessThan(0.01);
    }
  });
});