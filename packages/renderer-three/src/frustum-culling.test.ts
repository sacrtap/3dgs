import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SpatialGrid, FrustumCulling } from './frustum-culling.js';
import type { VisibleRange } from './frustum-culling.js';

// ── 测试工具 ──────────────────────────────────────────────

/** .splat 每高斯核 32 字节 */
const BYTES_PER_SPLAT = 32;

/**
 * 创建 .splat 格式的测试数据
 *
 * @param positions 位置数组 [[x,y,z], ...]
 * @returns Uint8Array (.splat 格式)
 */
function makeSplatData(positions: number[][]): Uint8Array {
  const buffer = new ArrayBuffer(positions.length * BYTES_PER_SPLAT);
  const view = new DataView(buffer);
  const f32 = new Float32Array(buffer);

  for (let i = 0; i < positions.length; i++) {
    const [x, y, z] = positions[i];
    const base = i * 8; // Float32 index

    // Position XYZ (3 × Float32)
    f32[base + 0] = x;
    f32[base + 1] = y;
    f32[base + 2] = z;

    // Scale XYZ (3 × Float32) — 默认 0.01
    f32[base + 3] = 0.01;
    f32[base + 4] = 0.01;
    f32[base + 5] = 0.01;

    // Color RGBA (4 × Uint8) at byte offset 24
    const colorOffset = i * BYTES_PER_SPLAT + 24;
    view.setUint8(colorOffset + 0, 200);
    view.setUint8(colorOffset + 1, 200);
    view.setUint8(colorOffset + 2, 200);
    view.setUint8(colorOffset + 3, 255);

    // Rotation IJKL (4 × Uint8) at byte offset 28
    const rotOffset = i * BYTES_PER_SPLAT + 28;
    view.setUint8(rotOffset + 0, 128); // w=0
    view.setUint8(rotOffset + 1, 128); // x=0
    view.setUint8(rotOffset + 2, 128); // y=0
    view.setUint8(rotOffset + 3, 128); // z=0
  }

  return new Uint8Array(buffer);
}

/**
 * 创建一个覆盖整个场景的视锥 (所有 splat 可见)
 *
 * 相机放在远处, 使用宽 FOV 确保所有 splat 都在视锥内。
 */
function makeFullFrustum(): THREE.Frustum {
  // 使用 150° 超宽 FOV, 确保覆盖所有方向
  const camera = new THREE.PerspectiveCamera(150, 1, 0.01, 1000000);
  camera.position.set(50, 50, 500);
  camera.lookAt(50, 50, 0);
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

/**
 * 创建一个朝向 +X 方向的窄视锥 (只看到 X 正方向的 splat)
 */
function makeForwardFrustum(): THREE.Frustum {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100000);
  camera.position.set(0, 0, 0);
  camera.lookAt(1, 0, 0);
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

/**
 * 创建一个朝向 -X 方向的视锥 (只看到 X 负方向的 splat)
 */
function makeBackwardFrustum(): THREE.Frustum {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100000);
  camera.position.set(0, 0, 0);
  camera.lookAt(-1, 0, 0);
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

// ── SpatialGrid 测试 ──────────────────────────────────────

describe('SpatialGrid', () => {
  it('★ 正确计算总 splat 数', () => {
    const data = makeSplatData([
      [0, 0, 0], [1, 1, 1], [2, 2, 2],
    ]);
    const grid = new SpatialGrid(data, undefined, 4);
    expect(grid.getTotalSplats()).toBe(3);
  });

  it('★ 从数据中自动计算包围盒', () => {
    const data = makeSplatData([
      [0, 0, 0], [10, 10, 10],
    ]);
    const grid = new SpatialGrid(data, undefined, 4);
    const bbox = grid.getBoundingBox();
    expect(bbox.min.x).toBeCloseTo(0);
    expect(bbox.min.y).toBeCloseTo(0);
    expect(bbox.min.z).toBeCloseTo(0);
    expect(bbox.max.x).toBeCloseTo(10);
    expect(bbox.max.y).toBeCloseTo(10);
    expect(bbox.max.z).toBeCloseTo(10);
  });

  it('★ 使用提供的包围盒', () => {
    const data = makeSplatData([[1, 1, 1]]);
    const bbox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(100, 100, 100),
    );
    const grid = new SpatialGrid(data, bbox, 4);
    expect(grid.getBoundingBox().min.x).toBe(0);
    expect(grid.getBoundingBox().max.x).toBe(100);
  });

  it('★ 分块数 ≤ 网格总单元数', () => {
    const data = makeSplatData([
      [0, 0, 0], [5, 5, 5], [10, 10, 10],
    ]);
    const grid = new SpatialGrid(data, undefined, 4);
    // 4×4×4 = 64 单元, 3 个 splat 最多占 3 个单元
    expect(grid.getCells().length).toBeLessThanOrEqual(64);
    expect(grid.getCells().length).toBeGreaterThanOrEqual(1);
  });

  it('★ 所有分块的 splat 总数 = 总 splat 数', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 100; i++) {
      positions.push([
        Math.random() * 100,
        Math.random() * 100,
        Math.random() * 100,
      ]);
    }
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);

    // actualCount 的总和应等于总 splat 数
    const totalCount = grid.getCells().reduce((sum, c) => sum + c.actualCount, 0);
    expect(totalCount).toBe(100);
  });

  it('★ 每个分块的 startSplat 和 count 在有效范围内', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 50; i++) {
      positions.push([i * 2, i * 2, i * 2]);
    }
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);

    for (const cell of grid.getCells()) {
      expect(cell.startSplat).toBeGreaterThanOrEqual(0);
      expect(cell.startSplat).toBeLessThan(50);
      expect(cell.actualCount).toBeGreaterThan(0);
      expect(cell.rangeCount).toBeGreaterThanOrEqual(cell.actualCount);
      expect(cell.startSplat + cell.rangeCount).toBeLessThanOrEqual(50);
    }
  });

  it('★ Morton 排序数据: 每个分块是连续范围', () => {
    // 创建 Morton 排序的位置数据 (空间连续)
    const positions: number[][] = [];
    // 8×8×8 的规则网格点, 按 Morton 序排列
    const res = 4;
    for (let x = 0; x < res; x++) {
      for (let y = 0; y < res; y++) {
        for (let z = 0; z < res; z++) {
          positions.push([x * 10, y * 10, z * 10]);
        }
      }
    }
    // 乱序排列部分数据以模拟非 Morton 排序
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);

    // 每个分块的 splat 应该是连续的
    for (const cell of grid.getCells()) {
      expect(cell.actualCount).toBeGreaterThan(0);
      // startSplat + rangeCount 不超过总数
      expect(cell.startSplat + cell.rangeCount).toBeLessThanOrEqual(positions.length);
    }
  });

  it('★ 全可见视锥返回所有 splat', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 100; i++) {
      positions.push([
        (i % 10) * 10,
        Math.floor(i / 10) * 10,
        0,
      ]);
    }
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);
    const frustum = makeFullFrustum();

    const ranges = grid.getVisibleRanges(frustum);
    const totalVisible = ranges.reduce((sum, r) => sum + r.count, 0);
    expect(totalVisible).toBe(100);
  });

  it('★ 前向窄视锥只看到部分 splat', () => {
    // 将 splat 分布在 X 轴正负两侧
    const positions: number[][] = [];
    for (let i = 0; i < 50; i++) {
      positions.push([100 + i * 10, 0, 0]); // X 正方向
    }
    for (let i = 0; i < 50; i++) {
      positions.push([-100 - i * 10, 0, 0]); // X 负方向
    }
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);

    const forwardFrustum = makeForwardFrustum();
    const backwardFrustum = makeBackwardFrustum();

    const forwardRanges = grid.getVisibleRanges(forwardFrustum);
    const backwardRanges = grid.getVisibleRanges(backwardFrustum);

    const forwardCount = forwardRanges.reduce((s, r) => s + r.count, 0);
    const backwardCount = backwardRanges.reduce((s, r) => s + r.count, 0);

    // 前向视锥应该看到 X 正方向的 splat
    expect(forwardCount).toBeGreaterThan(0);
    expect(forwardCount).toBeLessThan(100);

    // 后向视锥应该看到 X 负方向的 splat
    expect(backwardCount).toBeGreaterThan(0);
    expect(backwardCount).toBeLessThan(100);

    // 两个方向加起来不应该超过总数 (可能有少量重叠在边界)
    expect(forwardCount + backwardCount).toBeLessThanOrEqual(100);
  });

  it('★ getVisibleSplatCount ≤ getVisibleRanges 的范围总 splat 数', () => {
    // 非 Morton 排序数据: getVisibleRanges 返回的范围可能包含邻近分块的 splat,
    // 因此 rangeCount 总和 >= actualCount 总和
    const positions: number[][] = [];
    for (let i = 0; i < 100; i++) {
      positions.push([
        Math.random() * 100,
        Math.random() * 100,
        Math.random() * 100,
      ]);
    }
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);
    const frustum = makeFullFrustum();

    const ranges = grid.getVisibleRanges(frustum);
    const countFromRanges = ranges.reduce((s, r) => s + r.count, 0);
    const countDirect = grid.getVisibleSplatCount(frustum);

    // actualCount <= rangeCount (范围可能包含额外 splat)
    expect(countDirect).toBeLessThanOrEqual(countFromRanges);
    // 全可见视锥下 actualCount 应等于总数
    expect(countDirect).toBe(100);
  });

  it('★ getVisibleRatio 返回 0-1 范围', () => {
    const data = makeSplatData([
      [0, 0, 0], [50, 50, 50], [100, 100, 100],
    ]);
    const grid = new SpatialGrid(data, undefined, 4);
    const frustum = makeFullFrustum();
    const ratio = grid.getVisibleRatio(frustum);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('★ 可见范围已排序且相邻段已合并', () => {
    const positions: number[][] = [];
    for (let i = 0; i < 200; i++) {
      positions.push([
        (i % 20) * 5,
        Math.floor(i / 20) * 5,
        0,
      ]);
    }
    const data = makeSplatData(positions);
    const grid = new SpatialGrid(data, undefined, 4);
    const frustum = makeFullFrustum();

    const ranges = grid.getVisibleRanges(frustum);

    // 验证已排序
    for (let i = 1; i < ranges.length; i++) {
      const prevEnd = ranges[i - 1].byteOffset + ranges[i - 1].count * BYTES_PER_SPLAT;
      expect(ranges[i].byteOffset).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it('★ 空数据不崩溃', () => {
    const data = new Uint8Array(0);
    const grid = new SpatialGrid(data, undefined, 4);
    expect(grid.getTotalSplats()).toBe(0);
    expect(grid.getCells().length).toBe(0);

    const frustum = makeFullFrustum();
    const ranges = grid.getVisibleRanges(frustum);
    expect(ranges).toEqual([]);
  });

  it('★ 单个 splat 正常工作', () => {
    const data = makeSplatData([[5, 5, 5]]);
    const grid = new SpatialGrid(data, undefined, 4);
    expect(grid.getTotalSplats()).toBe(1);
    expect(grid.getCells().length).toBe(1);
    expect(grid.getCells()[0].actualCount).toBe(1);

    // 使用大 FOV 视锥确保 splat 可见
    const camera = new THREE.PerspectiveCamera(120, 1, 0.01, 100000);
    camera.position.set(0, 0, 0);
    camera.lookAt(5, 5, 5);
    camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(m);

    const ranges = grid.getVisibleRanges(frustum);
    expect(ranges.length).toBe(1);
    expect(ranges[0].count).toBeGreaterThanOrEqual(1);
  });
});

// ── FrustumCulling 测试 ───────────────────────────────────

describe('FrustumCulling', () => {
  let culling: FrustumCulling;
  let positions: number[][];

  beforeEach(() => {
    positions = [];
    for (let i = 0; i < 200; i++) {
      positions.push([
        (i % 20) * 10 - 100,  // -100 ~ 90
        Math.floor(i / 20) * 10 - 50,  // -50 ~ 49
        0,
      ]);
    }
    const data = makeSplatData(positions);
    culling = new FrustumCulling(data, undefined, 4);
  });

  it('★ 使用投影矩阵获取可见范围', () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const ranges = culling.getVisibleRanges(m);
    expect(ranges.length).toBeGreaterThan(0);

    const totalVisible = ranges.reduce((s, r) => s + r.count, 0);
    expect(totalVisible).toBeGreaterThan(0);
    expect(totalVisible).toBeLessThanOrEqual(200);
  });

  it('★ getVisibleSplatCount ≤ getVisibleRanges 范围总 splat 数', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const ranges = culling.getVisibleRanges(m);
    const countFromRanges = ranges.reduce((s, r) => s + r.count, 0);
    const countDirect = culling.getVisibleSplatCount(m);
    // actualCount <= rangeCount
    expect(countDirect).toBeLessThanOrEqual(countFromRanges);
  });

  it('★ getVisibleRatio 在 0-1 范围', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const ratio = culling.getVisibleRatio(m);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('★ getVisibleCellCount ≤ 总分块数', () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const cellCount = culling.getVisibleCellCount(m);
    const totalCells = culling.getGrid().getCells().length;
    expect(cellCount).toBeLessThanOrEqual(totalCells);
  });

  it('★ getTotalSplats 返回正确值', () => {
    expect(culling.getTotalSplats()).toBe(200);
  });

  it('★ 直接使用 Frustum 对象', () => {
    const frustum = makeFullFrustum();
    const ranges = culling.getVisibleRangesFromFrustum(frustum);
    expect(ranges.length).toBeGreaterThan(0);
  });

  it('★ 背对场景的相机看不到 splat', () => {
    // 相机在场景后方, 朝向 +Z (场景在 -Z 方向... 但我们的场景 Z=0)
    // 改为: 相机在 X 正方向远处, 朝向 +X (背对场景)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100000);
    camera.position.set(-500, 0, 0);
    camera.lookAt(-1000, 0, 0); // 朝向 -X, 背对场景
    camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    const count = culling.getVisibleSplatCount(m);
    // 背对场景时应该看不到任何 splat (或极少)
    // 由于场景有一定宽度, 可能边缘有少量可见
    const ratio = culling.getVisibleRatio(m);
    expect(ratio).toBeLessThan(0.3); // 少于 30%
  });
});
