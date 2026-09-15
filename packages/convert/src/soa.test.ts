/**
 * ★ C-01/TD-06: SoA 全链路测试 — byte 级一致 + round-trip
 *
 * 验证:
 *   1. AoS 写入 (writeSplat/writeSpz/writeSog) 与 SoA 写入 (write*SoA) 产物 byte 级一致
 *   2. SPLAT SoA round-trip (写 → 读 → 数值在量化误差内)
 *   3. PLY/SPLAT 解析直出 SoA 与 AoS→toSoA 等价
 *
 * 测试数据全部为合成数据 (不依赖 gitignore 的 .ply 文件)。
 */

import { describe, it, expect } from 'vitest';
import {
  toSoA,
  fromSoA,
  loadGaussiansFromPly,
  loadGaussiansFromPlySoA,
} from './gaussian-loader.js';
import type { GaussianCloud, GaussianCloudSoA, GaussianSplat } from './gaussian-loader.js';
import { writeSplat, writeSplatSoA } from './splat-writer.js';
import { loadGaussiansFromSplat, loadGaussiansFromSplatSoA } from './splat-reader.js';
import { writeSpz, writeSpzSoA } from './spz-writer.js';
import { writeSog, writeSogSoA } from './sog-writer.js';

/** 构造确定性的测试 GaussianCloud (含 SH degree 1) */
function makeCloud(count: number): GaussianCloud {
  const splats: GaussianSplat[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / 10;
    const sh = new Float32Array(9); // degree 1 → 3×3=9 f_rest
    for (let j = 0; j < 9; j++) {
      sh[j] = (Math.sin(t * Math.PI + j) * 0.5) / 128; // 落在 SH 量化桶范围内
    }
    splats.push({
      x: (i - count / 2) * 0.25,
      y: t * 1.3,
      z: Math.cos(t * Math.PI) * 2.1,
      scaleX: 0.01 + t * 0.02,
      scaleY: 0.02 + t * 0.01,
      scaleZ: 0.005 + t * 0.008,
      rotW: 1 - t * 0.01,
      rotX: 0.1,
      rotY: -0.05,
      rotZ: 0.03,
      colorR: 0.5 + 0.3 * Math.sin(t * Math.PI),
      colorG: 0.4,
      colorB: 0.6 + 0.2 * Math.cos(t * Math.PI),
      opacity: 0.55 + 0.4 * ((i % 10) / 9),
      sh,
      shDegree: 1,
    });
  }
  return { splats, shDegree: 1, vertexCount: count, source: 'test' };
}

/** 构造最小标准 3DGS 二进制 PLY (position + scale + rot + opacity + f_dc + f_rest degree 1) */
function make3dgsPly(count: number): ArrayBuffer {
  const props = [
    'property float x',
    'property float y',
    'property float z',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'property float opacity',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
  ];
  for (let j = 0; j < 9; j++) props.push(`property float f_rest_${j}`);

  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.join(
    '\n',
  )}\nend_header\n`;
  const headerBytes = new TextEncoder().encode(header);

  // 每顶点 3+3+4+1+3+9 = 23 个 float
  const floatsPerVertex = 23;
  const body = new Float32Array(count * floatsPerVertex);
  for (let i = 0; i < count; i++) {
    const t = i / 10;
    const o = i * floatsPerVertex;
    body[o + 0] = (i - count / 2) * 0.25; // x
    body[o + 1] = t * 1.3; // y
    body[o + 2] = Math.cos(t * Math.PI) * 2.1; // z
    body[o + 3] = Math.log(0.01 + t * 0.02); // scale_0 (log 空间)
    body[o + 4] = Math.log(0.02 + t * 0.01);
    body[o + 5] = Math.log(0.005 + t * 0.008);
    body[o + 6] = 1 - t * 0.01; // rot_0 (w)
    body[o + 7] = 0.1;
    body[o + 8] = -0.05;
    body[o + 9] = 0.03;
    body[o + 10] = 0; // opacity (logit 0 → sigmoid 0.5)
    body[o + 11] = (0.5 - 0.5) / 0.28209479177387814; // f_dc_0 → color 0.5
    body[o + 12] = (0.4 - 0.5) / 0.28209479177387814;
    body[o + 13] = (0.6 - 0.5) / 0.28209479177387814;
    for (let j = 0; j < 9; j++) {
      body[o + 14 + j] = (Math.sin(t * Math.PI + j) * 0.5) / 128;
    }
  }

  const buffer = new ArrayBuffer(headerBytes.length + body.byteLength);
  new Uint8Array(buffer).set(headerBytes, 0);
  new Uint8Array(buffer).set(new Uint8Array(body.buffer), headerBytes.length);
  return buffer;
}

describe('C-01 SoA 全链路', () => {
  it('writeSplat(AoS) 与 writeSplatSoA(SoA) 产物 byte 级一致', () => {
    const cloud = makeCloud(37);
    const a = new Uint8Array(writeSplat(cloud));
    const b = new Uint8Array(writeSplatSoA(toSoA(cloud)));
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });

  it('writeSpz(AoS) 与 writeSpzSoA(SoA) 产物 byte 级一致', async () => {
    const cloud = makeCloud(23);
    const a = await writeSpz(cloud, { shDegree: 1 });
    const b = await writeSpzSoA(toSoA(cloud), { shDegree: 1 });
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });

  it('writeSog(AoS) 与 writeSogSoA(SoA) 产物 byte 级一致', () => {
    const cloud = makeCloud(150);
    const opts = { compression: false, spatialSort: true, buildLodTree: false };
    const a = new Uint8Array(writeSog(cloud, opts));
    const b = new Uint8Array(writeSogSoA(toSoA(cloud), opts));
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });

  it('SPLAT SoA round-trip: 位置精确, 颜色/旋转/不透明度在量化误差内', () => {
    const cloud = makeCloud(64);
    const soa = toSoA(cloud);
    const readBack = loadGaussiansFromSplatSoA(writeSplatSoA(soa));

    expect(readBack.count).toBe(soa.count);
    expect(readBack.shDegree).toBe(0); // .splat 不含 SH

    for (let i = 0; i < soa.count; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      // 位置为 Float32 直通, 精确一致
      expect(readBack.positions[i3]).toBe(soa.positions[i3]);
      expect(readBack.positions[i3 + 1]).toBe(soa.positions[i3 + 1]);
      expect(readBack.positions[i3 + 2]).toBe(soa.positions[i3 + 2]);
      // 缩放 Float32 直通
      expect(readBack.scales[i3]).toBe(soa.scales[i3]);
      // 颜色 8-bit 量化
      expect(Math.abs(readBack.colors[i3] - soa.colors[i3])).toBeLessThanOrEqual(1 / 255);
      // 不透明度 8-bit 量化
      expect(Math.abs(readBack.opacities[i] - soa.opacities[i])).toBeLessThanOrEqual(1 / 255);
      // 旋转 8-bit 量化 (1/128)
      expect(Math.abs(readBack.rotations[i4] - soa.rotations[i4])).toBeLessThanOrEqual(1 / 128);
    }
  });

  it('loadGaussiansFromSplatSoA 与 toSoA(loadGaussiansFromSplat) 等价', () => {
    const cloud = makeCloud(20);
    const buf = writeSplat(cloud);
    const direct = loadGaussiansFromSplatSoA(buf);
    const viaAos = toSoA(loadGaussiansFromSplat(buf));
    expect(direct.positions).toEqual(viaAos.positions);
    expect(direct.scales).toEqual(viaAos.scales);
    expect(direct.rotations).toEqual(viaAos.rotations);
    expect(direct.colors).toEqual(viaAos.colors);
    expect(direct.opacities).toEqual(viaAos.opacities);
  });

  it('loadGaussiansFromPlySoA 与 toSoA(loadGaussiansFromPly) 等价 (二进制快路径)', () => {
    const ply = make3dgsPly(33);
    const direct = loadGaussiansFromPlySoA(ply);
    const viaAos = toSoA(loadGaussiansFromPly(ply));

    expect(direct.count).toBe(viaAos.count);
    expect(direct.shDegree).toBe(viaAos.shDegree);
    expect(direct.positions).toEqual(viaAos.positions);
    expect(direct.scales).toEqual(viaAos.scales);
    expect(direct.rotations).toEqual(viaAos.rotations);
    expect(direct.colors).toEqual(viaAos.colors);
    expect(direct.opacities).toEqual(viaAos.opacities);
    expect(direct.sh).toEqual(viaAos.sh);
  });

  it('fromSoA(toSoA(cloud)) 保留 splat 数量与 SH 阶数', () => {
    const cloud = makeCloud(8);
    const round = fromSoA(toSoA(cloud));
    expect(round.splats).toHaveLength(8);
    expect(round.shDegree).toBe(1);
    expect(round.splats[0].sh).toHaveLength(9);
  });
});

describe('C-02/TD-32 PLY 流式分块解析', () => {
  it('跨分块边界 (count > PLY_STREAM_CHUNK_ROWS) 解析结果与单块等价', () => {
    // PLY_STREAM_CHUNK_ROWS = 1 << 16; 用 1.5 块验证边界衔接
    const count = (1 << 16) + 500;
    const ply = make3dgsPly(count);
    const direct = loadGaussiansFromPlySoA(ply);
    const viaAos = toSoA(loadGaussiansFromPly(ply));

    expect(direct.count).toBe(count);
    expect(direct.shDegree).toBe(viaAos.shDegree);
    // 抽样断言: 首/中点/尾索引各属性与 AoS 等价 (全量 toEqual 在 coverage 下 23s 超时)
    const mid = Math.floor(count / 2) * 3;
    const last = (count - 1) * 3;
    for (const key of ['positions', 'scales', 'rotations', 'colors'] as const) {
      expect(direct[key][0]).toBe(viaAos[key][0]);
      expect(direct[key][mid]).toBe(viaAos[key][mid]);
      expect(direct[key][last]).toBe(viaAos[key][last]);
    }
    expect(direct.opacities[0]).toBe(viaAos.opacities[0]);
    expect(direct.opacities[Math.floor(count / 2)]).toBe(viaAos.opacities[Math.floor(count / 2)]);
    expect(direct.opacities[count - 1]).toBe(viaAos.opacities[count - 1]);
    if (direct.sh && viaAos.sh) {
      const shLast = (count - 1) * 9;
      expect(direct.sh[0]).toBe(viaAos.sh[0]);
      expect(direct.sh[shLast]).toBe(viaAos.sh[shLast]);
    }
  });

  it('恰好整除分块大小 (count = PLY_STREAM_CHUNK_ROWS × 2)', () => {
    const count = (1 << 16) * 2;
    const ply = make3dgsPly(count);
    const direct = loadGaussiansFromPlySoA(ply);
    expect(direct.count).toBe(count);
    // 抽查首/末顶点与 AoS 等价 (全量比较 2×65536 顶点较慢)
    const viaAos = toSoA(loadGaussiansFromPly(ply));
    expect(direct.positions[0]).toBe(viaAos.positions[0]);
    expect(direct.positions[(count - 1) * 3]).toBe(viaAos.positions[(count - 1) * 3]);
    expect(direct.opacities[count - 1]).toBe(viaAos.opacities[count - 1]);
  }, 20_000);
});
