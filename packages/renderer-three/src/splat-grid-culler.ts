/**
 * SplatGridCuller — WebGPU 路径空间分块视锥裁剪
 *
 * ★ TD-09: 替代 performFrustumCull 的 O(N×6) 逐 splat 中心点测试。
 *
 * 与 frustum-culling.ts 的 SpatialGrid 不同:
 *   - SpatialGrid 假设输入为 Morton 排序的 .splat 字节 (范围合并优化);
 *   - 本类输入为 WebGPU 的 SoA Float32Array positions (训练序/非 Morton),
 *     不做范围合并, 而是按 8³ 空间网格分组, 组内无序遍历。
 *
 * 复杂度: 构建 O(N), 裁剪 O(G + Σvisible_members) (G = 512)。
 * 精度: cell 级 bbox 相交测试 — 比逐中心点更保守 (可见数略增, 无假阴性)。
 *
 * 依赖: three.js Frustum / Box3 做 bbox 相交判断。
 */

import * as THREE from 'three';

/** 单个空间网格单元 */
export interface SplatGridCell {
  /** 单元内 splat 索引 (无序, 不依赖 Morton) */
  members: Uint32Array;
  /** 单元包围盒 */
  bbox: THREE.Box3;
}

/** 默认网格分辨率 (8³ = 512 单元) */
export const DEFAULT_GRID_RESOLUTION = 8;

/**
 * 空间分块裁剪器 — 构建 SoA positions 的 8³ 网格, cell 级视锥剔除
 */
export class SplatGridCuller {
  /** 空间网格单元 (公开只读, 供测试/调试验证构建正确性) */
  readonly cells: SplatGridCell[] = [];
  private resolution: number;
  private count: number;
  private bbox = new THREE.Box3();
  private cellSize = new THREE.Vector3();
  private positions: Float32Array;

  constructor(
    positions: Float32Array,
    count: number,
    resolution: number = DEFAULT_GRID_RESOLUTION,
  ) {
    if (count <= 0) {
      throw new Error('SplatGridCuller: count 必须大于 0');
    }
    this.positions = positions;
    this.count = count;
    this.resolution = resolution;

    this.computeBoundingBox();
    this.buildGrid();
  }

  /** 单次遍历计算场景包围盒 */
  private computeBoundingBox(): void {
    const { positions, count } = this;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    this.bbox.min.set(minX, minY, minZ);
    this.bbox.max.set(maxX, maxY, maxZ);
    this.cellSize.set(
      Math.max((maxX - minX) / this.resolution, 1e-9),
      Math.max((maxY - minY) / this.resolution, 1e-9),
      Math.max((maxZ - minZ) / this.resolution, 1e-9),
    );
  }

  /** 构建网格: 先计数再填充 members, 避免二次遍历分配 */
  private buildGrid(): void {
    const { resolution, count } = this;
    const cellCount = resolution * resolution * resolution;

    // 第一遍: 统计每个 cell 的成员数
    const cellCounts = new Uint32Array(cellCount);
    const { positions, bbox, cellSize } = this;
    const min = bbox.min;

    for (let i = 0; i < count; i++) {
      const cellIndex = this.cellIndexFor(i, min, cellSize);
      cellCounts[cellIndex]++;
    }

    // 分配 cells + members
    this.cells.length = 0;
    for (let c = 0; c < cellCount; c++) {
      this.cells.push({
        members: new Uint32Array(cellCounts[c]),
        bbox: new THREE.Box3(),
      });
    }

    // 第二遍: 填充 members + 计算 cell bbox
    const cellCursor = new Uint32Array(cellCount);

    // 跟踪每个 cell 的 min/max (x/y/z 交错)
    const cellMinX = new Float64Array(cellCount).fill(Infinity);
    const cellMinY = new Float64Array(cellCount).fill(Infinity);
    const cellMinZ = new Float64Array(cellCount).fill(Infinity);
    const cellMaxX = new Float64Array(cellCount).fill(-Infinity);
    const cellMaxY = new Float64Array(cellCount).fill(-Infinity);
    const cellMaxZ = new Float64Array(cellCount).fill(-Infinity);

    for (let i = 0; i < count; i++) {
      const cellIndex = this.cellIndexFor(i, min, cellSize);
      this.cells[cellIndex].members[cellCursor[cellIndex]++] = i;

      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      if (x < cellMinX[cellIndex]) cellMinX[cellIndex] = x;
      if (x > cellMaxX[cellIndex]) cellMaxX[cellIndex] = x;
      if (y < cellMinY[cellIndex]) cellMinY[cellIndex] = y;
      if (y > cellMaxY[cellIndex]) cellMaxY[cellIndex] = y;
      if (z < cellMinZ[cellIndex]) cellMinZ[cellIndex] = z;
      if (z > cellMaxZ[cellIndex]) cellMaxZ[cellIndex] = z;
    }

    for (let c = 0; c < cellCount; c++) {
      const cell = this.cells[c];
      cell.bbox.min.set(cellMinX[c], cellMinY[c], cellMinZ[c]);
      cell.bbox.max.set(cellMaxX[c], cellMaxY[c], cellMaxZ[c]);
    }
  }

  /** 计算 splat 所在 cell 索引 (0..resolution³-1) */
  private cellIndexFor(splatIndex: number, min: THREE.Vector3, cellSize: THREE.Vector3): number {
    const { positions } = this;
    const x = positions[splatIndex * 3];
    const y = positions[splatIndex * 3 + 1];
    const z = positions[splatIndex * 3 + 2];

    const gx = Math.min(this.resolution - 1, Math.floor((x - min.x) / cellSize.x));
    const gy = Math.min(this.resolution - 1, Math.floor((y - min.y) / cellSize.y));
    const gz = Math.min(this.resolution - 1, Math.floor((z - min.z) / cellSize.z));
    return (gx * this.resolution + gy) * this.resolution + gz;
  }

  /**
   * 视锥裁剪 — 输出可见位图 (内部先清零)
   *
   * @param frustum THREE.Frustum (由 VP 矩阵构建)
   * @param outMask 输出位图 (长度 >= count, 1=可见)
   * @returns 可见 splat 数 (Σ 命中 cell 的成员数)
   */
  cull(frustum: THREE.Frustum, outMask: Uint8Array): number {
    outMask.fill(0);
    let visible = 0;

    for (let c = 0; c < this.cells.length; c++) {
      const cell = this.cells[c];
      if (cell.members.length === 0) continue;
      if (!frustum.intersectsBox(cell.bbox)) continue;

      const members = cell.members;
      for (let k = 0; k < members.length; k++) {
        outMask[members[k]] = 1;
      }
      visible += members.length;
    }

    return visible;
  }
}
