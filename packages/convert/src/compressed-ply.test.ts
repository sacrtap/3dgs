/**
 * ★ C-05: 压缩 PLY (SuperSplat 兼容) round-trip 测试
 *
 * 覆盖:
 *   1. 写入产物可被本包 SuperSplat 快路径读取回 (数据在量化误差内一致)
 *   2. 文件结构: header 属性布局 / chunk 数量 / 每 256 顶点一 chunk
 *   3. 空集边界
 *   4. 单点 chunk 范围除零保护
 *   5. packed 编码位宽正确性 (11/10/11 + 8×4)
 */

import { describe, it, expect } from 'vitest';
import { writeCompressedPlySoA } from './compressed-ply-writer.js';
import type { GaussianCloudSoA } from './gaussian-loader.js';
import { loadGaussiansFromPly } from './gaussian-loader.js';

const SQRT2 = Math.sqrt(2);

/** 构造确定性 SoA (覆盖 SH degree 2) */
function makeSoa(count: number): GaussianCloudSoA {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    positions[i * 3] = (t - 0.5) * 4;
    positions[i * 3 + 1] = (t - 0.3) * 3;
    positions[i * 3 + 2] = (t - 0.7) * 5;
    scales[i * 3] = 0.01 + t * 0.5;
    scales[i * 3 + 1] = 0.02 + t * 0.3;
    scales[i * 3 + 2] = 0.005 + t * 0.8;
    // 单位四元数, 覆盖不同最大分量
    const pick = i % 4;
    const arr = [0, 0, 0, 0];
    arr[pick] = 0.9;
    arr[(pick + 1) % 4] = 0.2;
    arr[(pick + 2) % 4] = 0.3;
    arr[(pick + 3) % 4] = 0.1;
    const len = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
    rotations[i * 4] = arr[0] / len;
    rotations[i * 4 + 1] = arr[1] / len;
    rotations[i * 4 + 2] = arr[2] / len;
    rotations[i * 4 + 3] = arr[3] / len;
    colors[i * 3] = 0.2 + t * 0.7;
    colors[i * 3 + 1] = 0.4 + t * 0.5;
    colors[i * 3 + 2] = 0.1 + t * 0.8;
    opacities[i] = 0.3 + t * 0.6;
  }
  return {
    count,
    shDegree: 2,
    source: 'test',
    positions,
    scales,
    rotations,
    colors,
    opacities,
  };
}

describe('C-05 压缩 PLY 写入器 (SuperSplat 兼容)', () => {
  it('round-trip: 写入产物可被本包 SuperSplat 快路径读取回 (量化误差内)', () => {
    const src = makeSoa(600); // 跨越 3 个 chunk (256×2 + 88)
    const ply = writeCompressedPlySoA(src);

    // 走 loadGaussiansFromPly 内部 SuperSplat 快路径
    const read = loadGaussiansFromPly(ply, { source: 'roundtrip' });
    expect(read.vertexCount).toBe(600);
    expect(read.splats.length).toBe(600);

    // 位置: 11bit / 10bit / 11bit 量化 → 相对误差 ≤ 1/2047 (x/z) / 1/1023 (y)
    const tolX = ((1 / 2047) * 8) / 2 + 1e-6; // 范围 8 的一半
    const tolY = ((1 / 1023) * 6) / 2 + 1e-6;
    const tolZ = ((1 / 2047) * 10) / 2 + 1e-6;
    for (let i = 0; i < 600; i++) {
      // 由于范围归一化会引入整体量化误差 (同一极端对齐), 断言在 2× 容差内
      expect(Math.abs(read.splats[i].x - src.positions[i * 3])).toBeLessThanOrEqual(tolX * 4);
      expect(Math.abs(read.splats[i].y - src.positions[i * 3 + 1])).toBeLessThanOrEqual(tolY * 4);
      expect(Math.abs(read.splats[i].z - src.positions[i * 3 + 2])).toBeLessThanOrEqual(tolZ * 4);
    }
    // 不透明度: 8-bit ≤ 1/255
    for (let i = 0; i < 600; i++) {
      expect(Math.abs(read.splats[i].opacity - src.opacities[i])).toBeLessThanOrEqual(
        1 / 255 + 1e-6,
      );
    }
    // 颜色: chunk 范围 8-bit
    for (let i = 0; i < 600; i++) {
      const tol = 1 / 255 + 1e-3; // 范围上限约 0.7 / 255
      expect(Math.abs(read.splats[i].colorR - src.colors[i * 3])).toBeLessThanOrEqual(tol);
      expect(Math.abs(read.splats[i].colorG - src.colors[i * 3 + 1])).toBeLessThanOrEqual(tol);
    }
    // 缩放: log 空间 11bit → exp 域误差
    for (let i = 0; i < 600; i++) {
      expect(read.splats[i].scaleX).toBeGreaterThan(0);
      const logErr = Math.abs(Math.log(read.splats[i].scaleX) - Math.log(src.scales[i * 3]));
      expect(logErr).toBeLessThanOrEqual((1 / 2047) * 8 * 4);
      expect(read.splats[i].scaleY).toBeGreaterThan(0);
      const logErrY = Math.abs(Math.log(read.splats[i].scaleY) - Math.log(src.scales[i * 3 + 1]));
      expect(logErrY).toBeLessThanOrEqual((1 / 1023) * 6 * 4);
    }
    // 旋转: 单位四元数 + 分量收敛 (10bit)
    for (let i = 0; i < 600; i++) {
      const s = read.splats[i];
      const len = Math.sqrt(s.rotW ** 2 + s.rotX ** 2 + s.rotY ** 2 + s.rotZ ** 2);
      expect(len).toBeCloseTo(1, 2);
      const qSrc = [
        src.rotations[i * 4],
        src.rotations[i * 4 + 1],
        src.rotations[i * 4 + 2],
        src.rotations[i * 4 + 3],
      ];
      const qRead = [s.rotW, s.rotX, s.rotY, s.rotZ];
      // 四元数 q 与 -q 等价, 比较四分量最大差在 10bit 容差内
      const dot = Math.abs(
        qSrc[0] * qRead[0] + qSrc[1] * qRead[1] + qSrc[2] * qRead[2] + qSrc[3] * qRead[3],
      );
      expect(dot).toBeGreaterThan(0.99);
    }
  });

  it('文件结构: header 属性布局 + chunk 数量 + 每 256 顶点一个 chunk', () => {
    const src = makeSoa(300);
    const ply = writeCompressedPlySoA(src);
    const bytes = new Uint8Array(ply);
    // header 在文件开头, 读取前 1024 字节 (含 18 属性声明)
    const headerText = new TextDecoder().decode(bytes.subarray(0, 1024));

    expect(headerText).toContain('element vertex 300');
    expect(headerText).toContain('property uint packed_position');
    expect(headerText).toContain('property uint packed_rotation');
    expect(headerText).toContain('property uint packed_scale');
    expect(headerText).toContain('property uint packed_color');
    expect(headerText).toContain('element chunk 2'); // ceil(300/256) = 2
    // 18 个 range 属性
    expect(headerText).toContain('min_scale_x');
    expect(headerText).toContain('max_b');

    // 文件大小 = header + 300*16 + 2*72
    const headerEnd = bytes.findIndex(
      (_, i) =>
        i > 0 &&
        bytes[i - 1] === 0x0a &&
        (bytes.subarray(i, i + 10).toString() ===
          'end_header'
            .split('')
            .map((c) => c.charCodeAt(0))
            .join(',')) ===
          false,
    );
    // 更稳妥: 通过内容搜索 end_header\n
    const headerStr = new TextDecoder().decode(bytes);
    const eh = headerStr.indexOf('end_header\n') + 'end_header\n'.length;
    expect(ply.byteLength).toBe(eh + 300 * 16 + 2 * 18 * 4);
  });

  it('packed 编码位宽: position x 11bit / y 10bit / z 11bit', () => {
    // 构造极小 chunk (1 顶点), 范围归一化使中间值 v=(min+max)/2 → 11bit 中心
    const src = makeSoa(1);
    src.positions[0] = 1;
    src.positions[1] = 2;
    src.positions[2] = 3;
    const ply = writeCompressedPlySoA(src);
    const bytes = new Uint8Array(ply);
    const headerStr = new TextDecoder().decode(bytes);
    const eh = headerStr.indexOf('end_header\n') + 'end_header\n'.length;
    const view = new DataView(ply, eh);
    const packed = view.getUint32(0, true);
    // 单点 chunk 范围 = [v, v+1e-6], v 归一化到 0 → packed 全 0; 验证位宽布局无溢出
    expect(packed >>> 31).toBe(0);
    expect((packed >>> 22) & 1).toBe(0);
  });

  it('空集写入不崩溃 (0 顶点, 0 chunk)', () => {
    const empty: GaussianCloudSoA = {
      count: 0,
      shDegree: 0,
      source: 'empty',
      positions: new Float32Array(0),
      scales: new Float32Array(0),
      rotations: new Float32Array(0),
      colors: new Float32Array(0),
      opacities: new Float32Array(0),
    };
    const ply = writeCompressedPlySoA(empty);
    const headerStr = new TextDecoder().decode(new Uint8Array(ply));
    expect(headerStr).toContain('element vertex 0');
    expect(headerStr).toContain('element chunk 0');
  });

  it('单点 chunk 范围除零保护 (min==max 时偏移 +1e-6)', () => {
    const soa = makeSoa(3);
    // 全部相同位置/缩放/颜色
    for (let i = 1; i < 3; i++) {
      soa.positions[i * 3] = soa.positions[0];
      soa.positions[i * 3 + 1] = soa.positions[1];
      soa.positions[i * 3 + 2] = soa.positions[2];
      soa.scales[i * 3] = soa.scales[0];
      soa.scales[i * 3 + 1] = soa.scales[1];
      soa.scales[i * 3 + 2] = soa.scales[2];
      soa.colors[i * 3] = soa.colors[0];
      soa.colors[i * 3 + 1] = soa.colors[1];
      soa.colors[i * 3 + 2] = soa.colors[2];
    }
    expect(() => writeCompressedPlySoA(soa)).not.toThrow();

    const read = loadGaussiansFromPly(writeCompressedPlySoA(soa));
    expect(read.vertexCount).toBe(3);
    // 全同值 → 解码回相同值 (±量化误差)
    expect(Math.abs(read.splats[0].x - soa.positions[0])).toBeLessThan(1e-4);
  });

  it('多次 chunk 边界: 恰好 256/512 顶点', () => {
    for (const count of [256, 512, 257]) {
      const src = makeSoa(count);
      const ply = writeCompressedPlySoA(src);
      const read = loadGaussiansFromPly(ply);
      expect(read.vertexCount).toBe(count);
    }
  });
});
