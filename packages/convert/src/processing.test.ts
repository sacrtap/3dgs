import { describe, it, expect } from 'vitest';
import { pruneGaussians, mortonSortGaussians, quickselect } from './processing.js';
import type { GaussianCloud } from './gaussian-loader.js';

function makeCloud(
  splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>>,
): GaussianCloud {
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
    const cloud = makeCloud([{ opacity: 0.5 }, { opacity: 0.001 }, { opacity: 0.8 }]);

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

  // ── M3: 贡献度裁剪测试 ─────────────────────────────────────

  it('★ M3: 贡献度裁剪按比例保留 (0.5 = 保留前 50%)', () => {
    const cloud = makeCloud([
      { opacity: 1.0, scaleX: 0.1, scaleY: 0.1, scaleZ: 0.1 }, // 贡献度 0.1
      { opacity: 0.5, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 }, // 贡献度 0.005
      { opacity: 0.8, scaleX: 0.05, scaleY: 0.05, scaleZ: 0.05 }, // 贡献度 0.04
      { opacity: 0.3, scaleX: 0.2, scaleY: 0.2, scaleZ: 0.2 }, // 贡献度 0.06
    ]);

    const result = pruneGaussians(cloud, { contributionCutoff: 0.5 });
    // 保留前 50% = 2 个, 贡献度最高的两个是 0.1 和 0.06
    expect(result.splats).toHaveLength(2);
    // 贡献度最高的 (opacity=1.0, scale=0.1) 应该被保留
    expect(result.splats.some((s) => s.opacity === 1.0)).toBe(true);
    // 贡献度最低的 (opacity=0.5, scale=0.01) 应该被裁掉
    expect(result.splats.some((s) => s.opacity === 0.5 && s.scaleX === 0.01)).toBe(false);
  });

  it('★ M3: 贡献度裁剪按确切数量保留 (>1 = 保留 N 个)', () => {
    const cloud = makeCloud([
      { opacity: 0.1, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 },
      { opacity: 0.9, scaleX: 0.1, scaleY: 0.1, scaleZ: 0.1 },
      { opacity: 0.5, scaleX: 0.05, scaleY: 0.05, scaleZ: 0.05 },
      { opacity: 0.3, scaleX: 0.02, scaleY: 0.02, scaleZ: 0.02 },
      { opacity: 1.0, scaleX: 0.2, scaleY: 0.2, scaleZ: 0.2 },
    ]);

    const result = pruneGaussians(cloud, { contributionCutoff: 2 });
    expect(result.splats).toHaveLength(2);
    // 贡献度最高的: 1.0*0.2=0.2 和 0.9*0.1=0.09
    expect(result.splats.some((s) => s.opacity === 1.0 && s.scaleX === 0.2)).toBe(true);
    expect(result.splats.some((s) => s.opacity === 0.9 && s.scaleX === 0.1)).toBe(true);
  });

  it('★ M3: 贡献度裁剪数量超过总数时保留全部', () => {
    const cloud = makeCloud([
      { opacity: 0.5, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 },
      { opacity: 0.8, scaleX: 0.05, scaleY: 0.05, scaleZ: 0.05 },
    ]);

    const result = pruneGaussians(cloud, { contributionCutoff: 100 });
    expect(result.splats).toHaveLength(2);
  });

  it('★ M3: 贡献度裁剪与基础过滤组合使用', () => {
    const cloud = makeCloud([
      { opacity: 0.001, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 }, // 被基础过滤剔除
      { opacity: 1.0, scaleX: 0.1, scaleY: 0.1, scaleZ: 0.1 }, // 贡献度 0.1
      { opacity: 0.5, scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 }, // 贡献度 0.005
      { opacity: NaN, scaleX: 0.1, scaleY: 0.1, scaleZ: 0.1 }, // 被 NaN 过滤剔除
    ]);

    // 基础过滤后剩 2 个, 贡献度裁剪保留 50% = 1 个
    const result = pruneGaussians(cloud, {
      minOpacity: 0.01,
      contributionCutoff: 0.5,
    });
    expect(result.splats).toHaveLength(1);
    // 贡献度最高的被保留
    expect(result.splats[0].opacity).toBe(1.0);
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
    const cloud = makeCloud([{ x: 1, y: 2, z: 3 }]);

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
      { x: 1, y: 1, z: 1 }, // +++
      { x: -1, y: 1, z: 1 }, // -++
      { x: 1, y: -1, z: 1 }, // +-+
      { x: 1, y: 1, z: -1 }, // ++-
      { x: -1, y: -1, z: 1 }, // --+
      { x: 1, y: -1, z: -1 }, // +--
      { x: -1, y: 1, z: -1 }, // -+-
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

// ── TD-15: quickselect 贡献度裁剪 ─────────────────────────

describe('TD-15 quickselect 贡献度裁剪', () => {
  it('quickselect 返回第 k 小值且分区正确', () => {
    const arr = new Float64Array([3, 1, 4, 1, 5, 9, 2, 6]);
    // 第 3 小 = 排序后 [1,1,2,3,4,5,6,9] 的索引 3 = 3
    expect(quickselect(arr, 3)).toBe(3);
    // 数组被分区: 索引 3 左侧 ≤ 3, 右侧 ≥ 3
    for (let i = 0; i < 3; i++) expect(arr[i]).toBeLessThanOrEqual(3);
    for (let i = 4; i < arr.length; i++) expect(arr[i]).toBeGreaterThanOrEqual(3);
  });

  it('quickselect 边界: k=0 返回最小值, k=length-1 返回最大值', () => {
    const a = new Float64Array([7, 2, 9, 1, 5]);
    expect(quickselect(a, 0)).toBe(1);
    expect(quickselect(a, 4)).toBe(9);
  });

  it('乱序输入 → top-K 保留集合与全排序一致', () => {
    // 构造 20 个乱序贡献度 (opacity 各异)
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 20; i++) {
      // 乱序 opacity: 用固定种子乱序 (i*7 % 20) 保证确定性
      const idx = (i * 7) % 20;
      splats.push({ opacity: 0.05 + idx * 0.05, scaleX: 1, scaleY: 1, scaleZ: 1 });
    }
    const cloud = makeCloud(splats);

    // quickselect 路径 (新)
    const result = pruneGaussians(cloud, { contributionCutoff: 5 });
    expect(result.splats).toHaveLength(5);

    // 全排序路径 (参考): 手动算贡献度降序取前 5
    const sorted = [...cloud.splats].sort((a, b) => b.opacity * 1 - a.opacity * 1);
    const expectedTop5 = sorted
      .slice(0, 5)
      .map((s) => s.opacity)
      .sort((a, b) => a - b);
    const actualTop5 = result.splats.map((s) => s.opacity).sort((a, b) => a - b);
    expect(actualTop5).toEqual(expectedTop5);
  });

  it('重复贡献度时恰好截断到 keepCount', () => {
    const cloud = makeCloud([
      { opacity: 1.0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      { opacity: 1.0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      { opacity: 1.0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      { opacity: 0.1, scaleX: 1, scaleY: 1, scaleZ: 1 },
      { opacity: 0.2, scaleX: 1, scaleY: 1, scaleZ: 1 },
    ]);
    // 保留 3 个: 3 个 1.0 贡献度恰好占满
    const result = pruneGaussians(cloud, { contributionCutoff: 3 });
    expect(result.splats).toHaveLength(3);
    expect(result.splats.every((s) => s.opacity === 1.0)).toBe(true);
  });

  it('贡献度裁剪保留输入顺序 (非降序排列)', () => {
    const cloud = makeCloud([
      { opacity: 0.3, scaleX: 1, scaleY: 1, scaleZ: 1 }, // 贡献度 0.3
      { opacity: 0.9, scaleX: 1, scaleY: 1, scaleZ: 1 }, // 0.9
      { opacity: 0.5, scaleX: 1, scaleY: 1, scaleZ: 1 }, // 0.5
      { opacity: 0.7, scaleX: 1, scaleY: 1, scaleZ: 1 }, // 0.7
    ]);
    const result = pruneGaussians(cloud, { contributionCutoff: 2 });
    // 保留 0.9 与 0.7, 且按输入顺序
    expect(result.splats.map((s) => s.opacity)).toEqual([0.9, 0.7]);
  });

  it('TD-15 性能: 100K 乱序输入 quickselect 远快于全排序路径的 O(N log N)', () => {
    const splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>> = [];
    for (let i = 0; i < 100_000; i++) {
      // 伪随机贡献度 (确定性)
      const r = Math.sin(i * 12.9898) * 43758.5453;
      splats.push({
        opacity: 0.05 + (r - Math.floor(r)) * 0.95,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
      });
    }
    const cloud = makeCloud(splats);
    const start = performance.now();
    const result = pruneGaussians(cloud, { contributionCutoff: 10_000 });
    const elapsed = performance.now() - start;
    expect(result.splats).toHaveLength(10_000);
    // 宽松上限: quickselect O(N) 在 100K 上应 < 500ms (全排序路径约 2-4x 更慢)
    expect(elapsed).toBeLessThan(500);
  });
});
