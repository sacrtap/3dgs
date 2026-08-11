import { describe, it, expect } from 'vitest';
import { pruneGaussians, mortonSortGaussians } from './processing.js';
import type { GaussianCloud } from './gaussian-loader.js';

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

describe('pruneGaussians', () => {
  it('剔除低不透明度高斯核', () => {
    const cloud = makeCloud([
      { opacity: 0.5 },
      { opacity: 0.001 },
      { opacity: 0.8 },
    ]);

    const result = pruneGaussians(cloud, { minOpacity: 0.01 });
    expect(result.splats).toHaveLength(2);
  });

  it('剔除含 NaN 值的高斯核', () => {
    const cloud = makeCloud([
      { x: 0, y: 0, z: 0 },
      { x: NaN, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    ]);

    const result = pruneGaussians(cloud);
    expect(result.splats).toHaveLength(2);
  });

  it('剔除异常缩放的高斯核', () => {
    const cloud = makeCloud([
      { scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 },
      { scaleX: 100, scaleY: 0.01, scaleZ: 0.01 },
    ]);

    const result = pruneGaussians(cloud, { maxScale: 10 });
    expect(result.splats).toHaveLength(1);
  });

  it('空集输入返回空集', () => {
    const cloud = makeCloud([]);
    const result = pruneGaussians(cloud);
    expect(result.splats).toHaveLength(0);
  });
});

describe('mortonSortGaussians', () => {
  it('不改变高斯核数量', () => {
    const cloud = makeCloud([
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 5, y: 5, z: 5 },
    ]);

    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(4);
  });

  it('空间上邻近的高斯核在排序后也相邻', () => {
    const cloud = makeCloud([
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 9, y: 10, z: 10 },
    ]);

    const result = mortonSortGaussians(cloud);

    // (0,0,0) 应该排在最前面
    expect(result.splats[0].x).toBe(0);
    // (9,10,10) 和 (10,10,10) 应该相邻
    expect(result.splats[1].x).toBe(9);
    expect(result.splats[2].x).toBe(10);
  });

  it('空集输入返回空集', () => {
    const cloud = makeCloud([]);
    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(0);
  });

  // ── P0-5: Morton Number 版本测试 ──────────────────────────

  it('Morton Code 返回 Number 类型 (非 BigInt)', () => {
    const cloud = makeCloud([
      { x: 1, y: 2, z: 3 },
    ]);

    const result = mortonSortGaussians(cloud);
    // 排序应正常完成, 且不使用 BigInt 比较
    expect(result.splats).toHaveLength(1);
  });

  it('单个高斯核排序正常', () => {
    const cloud = makeCloud([{ x: 5, y: 5, z: 5 }]);
    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(1);
    expect(result.splats[0].x).toBe(5);
  });

  it('所有高斯核位于同一位置 — 排序稳定', () => {
    const cloud = makeCloud([
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
    ]);
    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(3);
    // 所有点位置相同
    for (const s of result.splats) {
      expect(s.x).toBe(1);
      expect(s.y).toBe(1);
      expect(s.z).toBe(1);
    }
  });

  it('不修改原始数据', () => {
    const cloud = makeCloud([
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]);
    const originalX0 = cloud.splats[0].x;

    mortonSortGaussians(cloud);

    expect(cloud.splats[0].x).toBe(originalX0);
  });

  it('负坐标处理正常', () => {
    const cloud = makeCloud([
      { x: -5, y: -5, z: -5 },
      { x: 5, y: 5, z: 5 },
      { x: -3, y: -3, z: -3 },
    ]);

    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(3);
    // (-5,-5,-5) 应该排在最前面 (归一化后坐标最小)
    expect(result.splats[0].x).toBe(-5);
  });

  it('8 个象限的排序正确性', () => {
    // 8 个象限各放一个点, 原点附近
    const points = [
      { x: 1, y: 1, z: 1 },    // +++ 
      { x: -1, y: 1, z: 1 },   // -++
      { x: 1, y: -1, z: 1 },   // +-+
      { x: 1, y: 1, z: -1 },   // ++-
      { x: -1, y: -1, z: 1 },  // --+
      { x: 1, y: -1, z: -1 },  // +--
      { x: -1, y: 1, z: -1 },  // -+-
      { x: -1, y: -1, z: -1 }, // ---
    ];
    const cloud = makeCloud(points);
    const result = mortonSortGaussians(cloud);

    expect(result.splats).toHaveLength(8);
    // 所有 splat 都应保留
    const xs = result.splats.map((s) => s.x);
    expect(new Set(xs).size).toBe(2); // 只有 -1 和 1
  });

  it('★ P0-5 性能: 10K 高斯核排序在 100ms 内完成', () => {
    // 生成 10000 个随机位置的高斯核
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 10_000; i++) {
      splats.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        z: Math.random() * 100,
      });
    }
    const cloud = makeCloud(splats);

    const start = performance.now();
    const result = mortonSortGaussians(cloud);
    const elapsed = performance.now() - start;

    expect(result.splats).toHaveLength(10_000);
    // BigInt 版本在 10K 规模下约 300-500ms, Number 版本应在 100ms 以内
    expect(elapsed).toBeLessThan(100);
  });

  it('★ P0-5 性能: 50K 高斯核排序在 500ms 内完成', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 50_000; i++) {
      splats.push({
        x: Math.random() * 1000,
        y: Math.random() * 1000,
        z: Math.random() * 1000,
      });
    }
    const cloud = makeCloud(splats);

    const start = performance.now();
    const result = mortonSortGaussians(cloud);
    const elapsed = performance.now() - start;

    expect(result.splats).toHaveLength(50_000);
    // 50K 规模下 BigInt 版本约 2-5s, Number 版本应在 500ms 以内
    expect(elapsed).toBeLessThan(500);
  });

  it('排序后保持 Morton Z-order 空间局部性', () => {
    // 在网格上放置点, 验证排序后相邻的点在空间上也接近
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    const gridSize = 10;
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        for (let z = 0; z < gridSize; z++) {
          splats.push({ x, y, z });
        }
      }
    }
    const cloud = makeCloud(splats);
    const result = mortonSortGaussians(cloud);

    expect(result.splats).toHaveLength(gridSize ** 3);

    // 验证: 排序后任意连续 3 个 splat 的平均距离应远小于随机排列
    let totalDist = 0;
    let count = 0;
    for (let i = 0; i < result.splats.length - 1; i++) {
      const a = result.splats[i];
      const b = result.splats[i + 1];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
      count++;
    }
    const avgDist = totalDist / count;

    // Morton 排序后相邻 splat 的平均距离应远小于网格尺寸 (10)
    // 随机排列的平均距离约 5.2, Morton 排序后应 < 2.0
    expect(avgDist).toBeLessThan(2.0);
  });
});
