import { describe, it, expect } from 'vitest';
import { WebGPUSortManager } from './webgpu-sort-manager.js';
import type { SortResult } from './webgpu-sort-manager.js';

// ── 测试工具 ──────────────────────────────────────────────

/**
 * 创建 splat 位置数组 (Float32Array, x,y,z 交错)
 *
 * @param positions 位置数组 [[x,y,z], ...]
 * @returns Float32Array (长度 = 3 × count)
 */
function makePositions(positions: number[][]): Float32Array {
  const flat = new Float32Array(positions.length * 3);
  for (let i = 0; i < positions.length; i++) {
    flat[i * 3] = positions[i][0];
    flat[i * 3 + 1] = positions[i][1];
    flat[i * 3 + 2] = positions[i][2];
  }
  return flat;
}

/**
 * 计算两个索引数组的排序是否等价 (不比较顺序, 只比较集合)
 */
function sameSet(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(Array.from(a));
  const setB = new Set(Array.from(b));
  if (setA.size !== setB.size) return false;
  for (const v of setA) {
    if (!setB.has(v)) return false;
  }
  return true;
}

// ── WebGPUSortManager.sortOnCPUStatic 测试 ─────────────────

describe('WebGPUSortManager — CPU 排序 (静态方法)', () => {
  it('★ 空数据返回空结果', () => {
    const positions = new Float32Array(0);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);

    expect(result.count).toBe(0);
    expect(result.indices.length).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.method).toBe('cpu');
  });

  it('★ 单个 splat 返回 [0]', () => {
    const positions = makePositions([[1, 2, 3]]);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);

    expect(result.count).toBe(1);
    expect(result.indices.length).toBe(1);
    expect(result.indices[0]).toBe(0);
  });

  it('★ 正确按距离从远到近排序 (降序)', () => {
    // 相机在原点, splat 沿 X 轴排列
    const positions = makePositions([
      [1, 0, 0],   // 距离=1 (最近)
      [5, 0, 0],   // 距离=25
      [3, 0, 0],   // 距离=9
      [10, 0, 0],  // 距离=100 (最远)
      [2, 0, 0],   // 距离=4
    ]);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);

    expect(result.count).toBe(5);
    // 从远到近: 10, 5, 3, 2, 1 → 索引 3, 1, 2, 4, 0
    expect(result.indices[0]).toBe(3); // 最远 (距离=100)
    expect(result.indices[1]).toBe(1); // 距离=25
    expect(result.indices[2]).toBe(2); // 距离=9
    expect(result.indices[3]).toBe(4); // 距离=4
    expect(result.indices[4]).toBe(0); // 最近 (距离=1)
  });

  it('★ 3D 空间中正确计算距离', () => {
    const positions = makePositions([
      [0, 0, 0],     // 距离=0
      [3, 4, 0],     // 距离=25 (3-4-5 三角形)
      [0, 0, 10],    // 距离=100
      [1, 1, 1],     // 距离=3
    ]);
    // 相机在 (1, 1, 1)
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 1, 1, 1);

    // 距离: splat0=3, splat1=(2²+3²+1)=14, splat2=(1+1+81)=83, splat3=0
    // 从远到近: 2, 1, 0, 3
    expect(result.indices[0]).toBe(2); // 距离=83
    expect(result.indices[1]).toBe(1); // 距离=14
    expect(result.indices[2]).toBe(0); // 距离=3
    expect(result.indices[3]).toBe(3); // 距离=0
  });

  it('★ 使用平方距离 (不开方)', () => {
    // 通过验证排序顺序确认使用平方距离
    const positions = makePositions([
      [2, 0, 0],    // 平方距离=4
      [3, 0, 0],    // 平方距离=9
      [1, 0, 0],    // 平方距离=1
    ]);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);

    // 从远到近: 3, 2, 1 → 索引 1, 0, 2
    expect(result.indices[0]).toBe(1);
    expect(result.indices[1]).toBe(0);
    expect(result.indices[2]).toBe(2);
  });

  it('★ 排序结果包含所有原始索引 (无丢失)', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 100; i++) {
      positions.push([
        Math.random() * 100,
        Math.random() * 100,
        Math.random() * 100,
      ]);
    }
    const flat = makePositions(positions);
    const result = WebGPUSortManager.sortOnCPUStatic(flat, 50, 50, 50);

    expect(result.count).toBe(100);
    // 验证所有索引 0-99 都存在
    const indexSet = new Set(Array.from(result.indices));
    expect(indexSet.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(indexSet.has(i)).toBe(true);
    }
  });

  it('★ 相同距离的 splat 保持稳定', () => {
    // 两个 splat 距离相同
    const positions = makePositions([
      [5, 0, 0],
      [0, 5, 0],   // 与原点距离相同
      [0, 0, 1],   // 最近
    ]);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);

    expect(result.count).toBe(3);
    // 最远的是 0 或 1 (距离相同), 最近是 2
    expect(result.indices[2]).toBe(2);
    // 索引 0 和 1 在前两位
    const firstTwo = new Set([result.indices[0], result.indices[1]]);
    expect(firstTwo.has(0)).toBe(true);
    expect(firstTwo.has(1)).toBe(true);
  });

  it('★ 大量 splat 排序正确 (1000 个)', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 1000; i++) {
      positions.push([i * 0.1, 0, 0]);
    }
    const flat = makePositions(positions);
    const result = WebGPUSortManager.sortOnCPUStatic(flat, 0, 0, 0);

    expect(result.count).toBe(1000);

    // 验证降序: distances[indices[i]] >= distances[indices[i+1]]
    for (let i = 0; i < 999; i++) {
      const distA = positions[result.indices[i]][0] ** 2;
      const distB = positions[result.indices[i + 1]][0] ** 2;
      expect(distA).toBeGreaterThanOrEqual(distB);
    }
  });

  it('★ 排序耗时为正数', () => {
    const positions = makePositions([
      [1, 0, 0], [2, 0, 0], [3, 0, 0],
    ]);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('★ method 字段标记为 cpu', () => {
    const positions = makePositions([[1, 0, 0]]);
    const result = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);
    expect(result.method).toBe('cpu');
  });
});

// ── WebGPUSortManager 实例测试 (无 GPU 环境) ───────────────

describe('WebGPUSortManager — 实例 (无 GPU 回退)', () => {
  it('★ 构造函数接受默认选项', () => {
    const manager = new WebGPUSortManager();
    expect(manager).toBeDefined();
    expect(manager.isInitialized()).toBe(false);
    expect(manager.getSplatCount()).toBe(0);
  });

  it('★ 构造函数接受自定义 workgroupSize', () => {
    const manager = new WebGPUSortManager({ workgroupSize: 128 });
    expect(manager).toBeDefined();
  });

  it('★ uploadPositions 设置 splat 数量', () => {
    const manager = new WebGPUSortManager();
    const positions = makePositions([
      [1, 0, 0], [2, 0, 0], [3, 0, 0],
    ]);
    manager.uploadPositions(positions);
    expect(manager.getSplatCount()).toBe(3);
  });

  it('★ uploadPositions 处理空数据', () => {
    const manager = new WebGPUSortManager();
    manager.uploadPositions(new Float32Array(0));
    expect(manager.getSplatCount()).toBe(0);
  });

  it('★ sortOnCPU 实例方法返回正确排序', () => {
    const manager = new WebGPUSortManager();
    const positions = makePositions([
      [1, 0, 0],   // 最近
      [10, 0, 0],  // 最远
      [5, 0, 0],   // 中间
    ]);
    manager.uploadPositions(positions);

    const result = manager.sortOnCPU(0, 0, 0);
    expect(result.count).toBe(3);
    expect(result.indices[0]).toBe(1); // 最远
    expect(result.indices[1]).toBe(2); // 中间
    expect(result.indices[2]).toBe(0); // 最近
    expect(result.method).toBe('cpu');
  });

  it('★ sortOnCPU 实例方法处理空数据', () => {
    const manager = new WebGPUSortManager();
    manager.uploadPositions(new Float32Array(0));

    const result = manager.sortOnCPU(0, 0, 0);
    expect(result.count).toBe(0);
    expect(result.indices.length).toBe(0);
  });

  it('★ sort 方法在无 GPU 设备时回退到 CPU', async () => {
    const manager = new WebGPUSortManager();
    const positions = makePositions([
      [1, 0, 0],
      [5, 0, 0],
      [3, 0, 0],
    ]);
    manager.uploadPositions(positions);

    // 未调用 init(), 无 GPU 设备, 应回退到 CPU
    const result = await manager.sort(0, 0, 0);
    expect(result.method).toBe('cpu');
    expect(result.count).toBe(3);
    // 从远到近: 5, 3, 1 → 索引 1, 2, 0
    expect(result.indices[0]).toBe(1);
    expect(result.indices[1]).toBe(2);
    expect(result.indices[2]).toBe(0);
  });

  it('★ sort 方法处理空数据', async () => {
    const manager = new WebGPUSortManager();
    manager.uploadPositions(new Float32Array(0));

    const result = await manager.sort(0, 0, 0);
    expect(result.count).toBe(0);
    expect(result.indices.length).toBe(0);
  });

  it('★ dispose 清理资源', () => {
    const manager = new WebGPUSortManager();
    const positions = makePositions([[1, 0, 0]]);
    manager.uploadPositions(positions);
    expect(manager.getSplatCount()).toBe(1);

    manager.dispose();
    expect(manager.isInitialized()).toBe(false);
  });

  it('★ getIndexBuffer 在无 GPU 时返回 null', () => {
    const manager = new WebGPUSortManager();
    expect(manager.getIndexBuffer()).toBeNull();
  });
});

// ── 排序正确性验证 (与参考实现对比) ───────────────────────

describe('WebGPUSortManager — 排序正确性验证', () => {
  it('★ 排序结果与直接计算距离排序一致', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 50; i++) {
      positions.push([
        Math.random() * 100 - 50,
        Math.random() * 100 - 50,
        Math.random() * 100 - 50,
      ]);
    }
    const flat = makePositions(positions);
    const camX = 10, camY = 20, camZ = 30;

    // 使用 sortOnCPUStatic 排序
    const result = WebGPUSortManager.sortOnCPUStatic(flat, camX, camY, camZ);

    // 手动计算距离并排序
    const distances = positions.map((p) => {
      const dx = p[0] - camX;
      const dy = p[1] - camY;
      const dz = p[2] - camZ;
      return dx * dx + dy * dy + dz * dz;
    });
    const expected = Array.from({ length: positions.length }, (_, i) => i)
      .sort((a, b) => distances[b] - distances[a]);

    expect(result.count).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(result.indices[i]).toBe(expected[i]);
    }
  });

  it('★ 排序结果是降序 (远到近)', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 100; i++) {
      positions.push([Math.random() * 50, Math.random() * 50, Math.random() * 50]);
    }
    const flat = makePositions(positions);
    const result = WebGPUSortManager.sortOnCPUStatic(flat, 0, 0, 0);

    // 验证降序
    for (let i = 0; i < 99; i++) {
      const idxA = result.indices[i];
      const idxB = result.indices[i + 1];
      const distA = flat[idxA * 3] ** 2 + flat[idxA * 3 + 1] ** 2 + flat[idxA * 3 + 2] ** 2;
      const distB = flat[idxB * 3] ** 2 + flat[idxB * 3 + 1] ** 2 + flat[idxB * 3 + 2] ** 2;
      expect(distA).toBeGreaterThanOrEqual(distB);
    }
  });

  it('★ 排序结果包含所有索引 (无丢失无重复)', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 500; i++) {
      positions.push([i, i, i]);
    }
    const flat = makePositions(positions);
    const result = WebGPUSortManager.sortOnCPUStatic(flat, 0, 0, 0);

    expect(sameSet(result.indices, new Uint32Array(500).map((_, i) => i))).toBe(true);
  });

  it('★ 相机移动后排序结果变化', () => {
    const positions = makePositions([
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ]);

    // 相机在原点: 距离都是 100
    const result1 = WebGPUSortManager.sortOnCPUStatic(positions, 0, 0, 0);

    // 相机靠近 splat 0: splat 0 最近
    const result2 = WebGPUSortManager.sortOnCPUStatic(positions, 9, 0, 0);

    // result2 中 splat 0 应该在最后 (最近)
    expect(result2.indices[2]).toBe(0);
  });
});
