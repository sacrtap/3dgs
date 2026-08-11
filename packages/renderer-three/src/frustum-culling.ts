/**
 * 视锥剔除预处理 — 基于 Morton 排序数据的空间分块视锥剔除
 *
 * ★ P2-1 优化: 深度优化
 *
 * 问题: 3DGS 每帧渲染全部 splat, 视锥外的 splat 被浪费。
 *
 * 方案: 基于 SOG 的 Morton 排序数据, 实现空间分块视锥剔除。
 *   1. 将场景空间划分为 N×N×N 网格 (默认 8×8×8 = 512 个空间分块)
 *   2. 每个分块记录包含的 splat 范围 (Morton 排序后空间连续)
 *   3. 每帧计算各分块是否在视锥内
 *   4. 仅返回视锥内分块的 splat 范围
 *
 * 关键优化: 由于 SOG 数据经过 Morton 排序, 空间上邻近的 splat 在
 * 数据数组中也相邻。因此每个空间分块对应的 splat 是连续的,
 * 可以用 {offset, count} 表示, 无需逐 splat 检测。
 *
 * 注意: 当数据未经 Morton 排序时, 同一分块的 splat 可能不连续。
 * 此时分块范围 (startSplat ~ startSplat + rangeCount) 会包含少量
 * 邻近分块的 splat。这对粗粒度视锥剔除是可接受的 (多渲染少量 splat
 * 比逐个检测更高效)。actualCount 记录该分块实际包含的 splat 数,
 * 用于精确统计。
 *
 * .splat 格式 (32 bytes/splat):
 *   Position XYZ  3 × Float32  (bytes 0-11)
 *   Scale XYZ     3 × Float32  (bytes 12-23)
 *   Color RGBA    4 × Uint8    (bytes 24-27)
 *   Rotation IJKL 4 × Uint8    (bytes 28-31)
 *
 * [来源: 性能优化方案 — docs/plan/07-性能深度分析与优化执行方案.md §10.1]
 * [来源: Morton Code — en.wikipedia.org/wiki/Z-order_curve]
 * [来源: Three.js Frustum — three.js docs #api/en/math/Frustum]
 */

import * as THREE from 'three';

/** .splat 每高斯核字节数 */
const SPLAT_BYTES_PER_SPLAT = 32;

/** 默认网格分辨率 (每轴分块数) */
const DEFAULT_GRID_RESOLUTION = 8;

/** 空间分块 — 记录一个网格单元内的 splat 范围 */
export interface SpatialCell {
  /** 网格坐标 X (0 ~ resolution-1) */
  gx: number;
  /** 网格坐标 Y */
  gy: number;
  /** 网格坐标 Z */
  gz: number;
  /** 起始 splat 索引 (在 splat 数组中的位置) */
  startSplat: number;
  /** 范围内 splat 数 (包含可能的邻近分块 splat, 用于渲染范围) */
  rangeCount: number;
  /** 实际属于该分块的 splat 数 (用于精确统计) */
  actualCount: number;
  /** 该分块的包围盒 */
  bbox: THREE.Box3;
  /** 该分块的中心点 */
  center: THREE.Vector3;
}

/** 可见范围 — 视锥内的 splat 连续段 */
export interface VisibleRange {
  /** 在 .splat 数据中的字节偏移 */
  byteOffset: number;
  /** splat 数量 */
  count: number;
}

/**
 * SpatialGrid — 空间分块网格
 *
 * 从 .splat 格式数据构建空间分块索引。
 * 利用 Morton 排序特性: 每个空间分块的 splat 在数据中是连续的。
 *
 * 构建复杂度: O(N) — 单次遍历
 * 查询复杂度: O(G) — G = 网格分块数 (默认 512)
 */
export class SpatialGrid {
  private cells: SpatialCell[] = [];
  private resolution: number;
  private bbox: THREE.Box3;
  private cellSize: THREE.Vector3;
  private totalSplats: number;

  /**
   * 从 .splat 数据构建空间网格
   *
   * @param splatData .splat 格式的 Uint8Array (32 bytes/splat)
   * @param bbox 场景包围盒 (若未提供, 从数据中计算)
   * @param resolution 网格分辨率 (默认 8, 即 8×8×8 = 512 分块)
   */
  constructor(
    splatData: Uint8Array,
    bbox?: THREE.Box3,
    resolution: number = DEFAULT_GRID_RESOLUTION,
  ) {
    this.resolution = resolution;
    this.totalSplats = Math.floor(splatData.byteLength / SPLAT_BYTES_PER_SPLAT);

    // 1. 计算或使用提供的包围盒
    if (bbox) {
      this.bbox = bbox.clone();
    } else {
      this.bbox = this.computeBoundingBox(splatData);
    }

    // 2. 计算每个分块的大小 (防止退化: 确保 cellSize > 0)
    const size = new THREE.Vector3();
    this.bbox.getSize(size);
    // 若包围盒退化 (所有 splat 在同一平面或点), 扩展最小尺寸
    const eps = 1e-6;
    if (size.x < eps) size.x = 1;
    if (size.y < eps) size.y = 1;
    if (size.z < eps) size.z = 1;
    this.cellSize = size.divideScalar(resolution);

    // 3. 构建分块索引
    this.buildGrid(splatData);
  }

  /**
   * 获取所有空间分块
   */
  getCells(): SpatialCell[] {
    return this.cells;
  }

  /**
   * 获取网格分辨率
   */
  getResolution(): number {
    return this.resolution;
  }

  /**
   * 获取总 splat 数
   */
  getTotalSplats(): number {
    return this.totalSplats;
  }

  /**
   * 获取场景包围盒
   */
  getBoundingBox(): THREE.Box3 {
    return this.bbox;
  }

  /**
   * 获取所有可见分块的 splat 范围
   *
   * 遍历所有分块, 检查其包围盒是否与视锥相交,
   * 返回可见分块的 splat 范围列表。
   *
   * 相邻可见分块会合并为更大的范围, 减少返回的段数。
   *
   * @param frustum Three.js 视锥体
   * @returns 可见范围数组 (已按 offset 排序, 相邻段已合并)
   */
  getVisibleRanges(frustum: THREE.Frustum): VisibleRange[] {
    const visibleCells: SpatialCell[] = [];

    for (const cell of this.cells) {
      if (cell.actualCount === 0) continue;
      if (frustum.intersectsBox(cell.bbox)) {
        visibleCells.push(cell);
      }
    }

    // 按 startSplat 排序, 以便合并相邻范围
    visibleCells.sort((a, b) => a.startSplat - b.startSplat);

    // 合并相邻的范围 (减少返回段数)
    return this.mergeAdjacentRanges(visibleCells);
  }

  /**
   * 获取可见 splat 数量 (不返回具体范围, 仅用于统计)
   *
   * 比 getVisibleRanges 更快 — 不做排序和合并。
   * 使用 actualCount 精确统计, 不会超过总 splat 数。
   */
  getVisibleSplatCount(frustum: THREE.Frustum): number {
    let count = 0;
    for (const cell of this.cells) {
      if (cell.actualCount > 0 && frustum.intersectsBox(cell.bbox)) {
        count += cell.actualCount;
      }
    }
    return count;
  }

  /**
   * 获取可见分块数
   */
  getVisibleCellCount(frustum: THREE.Frustum): number {
    let count = 0;
    for (const cell of this.cells) {
      if (cell.actualCount > 0 && frustum.intersectsBox(cell.bbox)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 获取分块总可见率 (0-1)
   *
   * 用于调试和性能监控: 值越低表示视锥剔除效果越好
   */
  getVisibleRatio(frustum: THREE.Frustum): number {
    if (this.totalSplats === 0) return 0;
    return this.getVisibleSplatCount(frustum) / this.totalSplats;
  }

  // ── 内部方法 ──

  /** 从 .splat 数据计算包围盒 */
  private computeBoundingBox(splatData: Uint8Array): THREE.Box3 {
    const numSplats = Math.floor(splatData.byteLength / SPLAT_BYTES_PER_SPLAT);
    const view = new DataView(splatData.buffer, splatData.byteOffset, splatData.byteLength);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < numSplats; i++) {
      const offset = i * SPLAT_BYTES_PER_SPLAT;
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    if (numSplats === 0) {
      return new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    }

    return new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ),
    );
  }

  /**
   * 构建空间分块网格
   *
   * 算法:
   *   1. 为每个网格单元记录 firstSplat, lastSplat, actualCount
   *   2. 遍历所有 splat, 计算其所属单元, 更新桶的范围
   *   3. 由于数据是 Morton 排序的, 每个桶的 splat 是连续的
   *      (非 Morton 排序数据中, firstSplat~lastSplat 范围可能包含邻近分块的 splat)
   *   4. 为每个非空桶创建 SpatialCell
   */
  private buildGrid(splatData: Uint8Array): void {
    const numSplats = this.totalSplats;
    const view = new DataView(splatData.buffer, splatData.byteOffset, splatData.byteLength);
    const res = this.resolution;

    // 为每个网格单元记录 [firstSplat, lastSplat, actualCount]
    // -1 = 空桶
    const cellFirst = new Int32Array(res * res * res).fill(-1);
    const cellLast = new Int32Array(res * res * res).fill(-1);
    const cellCount = new Int32Array(res * res * res).fill(0);

    const min = this.bbox.min;
    const cs = this.cellSize;

    // 防止除以 0
    const invCx = cs.x > 0 ? 1 / cs.x : 0;
    const invCy = cs.y > 0 ? 1 / cs.y : 0;
    const invCz = cs.z > 0 ? 1 / cs.z : 0;

    for (let i = 0; i < numSplats; i++) {
      const offset = i * SPLAT_BYTES_PER_SPLAT;
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);

      // 计算网格坐标 (clamp 到 [0, res-1])
      const gx = Math.min(res - 1, Math.max(0, Math.floor((x - min.x) * invCx)));
      const gy = Math.min(res - 1, Math.max(0, Math.floor((y - min.y) * invCy)));
      const gz = Math.min(res - 1, Math.max(0, Math.floor((z - min.z) * invCz)));

      const cellIdx = gx * res * res + gy * res + gz;

      if (cellFirst[cellIdx] === -1) {
        cellFirst[cellIdx] = i;
      }
      // 更新 lastSplat (由于遍历是顺序的, i 总是递增)
      cellLast[cellIdx] = i;
      cellCount[cellIdx]++;
    }

    // 构建非空分块的 SpatialCell
    this.cells = [];
    for (let idx = 0; idx < cellFirst.length; idx++) {
      if (cellFirst[idx] === -1) continue;

      const gx = Math.floor(idx / (res * res));
      const gy = Math.floor((idx % (res * res)) / res);
      const gz = idx % res;

      const startSplat = cellFirst[idx];
      const lastSplat = cellLast[idx];
      const rangeCount = lastSplat - startSplat + 1;
      const actualCount = cellCount[idx];

      // 计算分块包围盒
      const cellMin = new THREE.Vector3(
        min.x + gx * cs.x,
        min.y + gy * cs.y,
        min.z + gz * cs.z,
      );
      const cellMax = new THREE.Vector3(
        min.x + (gx + 1) * cs.x,
        min.y + (gy + 1) * cs.y,
        min.z + (gz + 1) * cs.z,
      );
      const cellCenter = new THREE.Vector3();
      cellCenter.copy(cellMin).add(cellMax).multiplyScalar(0.5);

      this.cells.push({
        gx, gy, gz,
        startSplat,
        rangeCount,
        actualCount,
        bbox: new THREE.Box3(cellMin, cellMax),
        center: cellCenter,
      });
    }
  }

  /** 合并相邻的可见范围为更大的连续段 */
  private mergeAdjacentRanges(cells: SpatialCell[]): VisibleRange[] {
    if (cells.length === 0) return [];

    const ranges: VisibleRange[] = [];
    let currentStart = cells[0].startSplat;
    let currentEnd = cells[0].startSplat + cells[0].rangeCount;

    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i];
      const cellStart = cell.startSplat;
      const cellEnd = cell.startSplat + cell.rangeCount;

      // 如果当前分块与前一个相邻 (或重叠), 合并
      if (cellStart <= currentEnd) {
        currentEnd = Math.max(currentEnd, cellEnd);
      } else {
        // 不相邻, 输出当前范围
        ranges.push({
          byteOffset: currentStart * SPLAT_BYTES_PER_SPLAT,
          count: currentEnd - currentStart,
        });
        currentStart = cellStart;
        currentEnd = cellEnd;
      }
    }

    // 输出最后一个范围
    ranges.push({
      byteOffset: currentStart * SPLAT_BYTES_PER_SPLAT,
      count: currentEnd - currentStart,
    });

    return ranges;
  }
}

/**
 * FrustumCulling — 视锥剔除管理器
 *
 * 封装 SpatialGrid, 提供基于相机矩阵的视锥剔除查询。
 *
 * 使用方式:
 *   const culling = new FrustumCulling(splatData, bbox);
 *   // 每帧:
 *   const projScreenMatrix = new THREE.Matrix4()
 *     .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
 *   const ranges = culling.getVisibleRanges(projScreenMatrix);
 *   // ranges = [{ byteOffset, count }, ...]
 */
export class FrustumCulling {
  private grid: SpatialGrid;
  private frustum: THREE.Frustum;

  constructor(
    splatData: Uint8Array,
    bbox?: THREE.Box3,
    resolution: number = DEFAULT_GRID_RESOLUTION,
  ) {
    this.grid = new SpatialGrid(splatData, bbox, resolution);
    this.frustum = new THREE.Frustum();
  }

  /**
   * 根据投影-屏幕矩阵获取可见范围
   *
   * @param projScreenMatrix camera.projectionMatrix × camera.matrixWorldInverse
   * @returns 可见范围数组
   */
  getVisibleRanges(projScreenMatrix: THREE.Matrix4): VisibleRange[] {
    this.frustum.setFromProjectionMatrix(projScreenMatrix);
    return this.grid.getVisibleRanges(this.frustum);
  }

  /**
   * 直接使用 Frustum 对象获取可见范围
   */
  getVisibleRangesFromFrustum(frustum: THREE.Frustum): VisibleRange[] {
    return this.grid.getVisibleRanges(frustum);
  }

  /**
   * 获取可见 splat 数量
   */
  getVisibleSplatCount(projScreenMatrix: THREE.Matrix4): number {
    this.frustum.setFromProjectionMatrix(projScreenMatrix);
    return this.grid.getVisibleSplatCount(this.frustum);
  }

  /**
   * 获取可见率 (0-1)
   */
  getVisibleRatio(projScreenMatrix: THREE.Matrix4): number {
    this.frustum.setFromProjectionMatrix(projScreenMatrix);
    return this.grid.getVisibleRatio(this.frustum);
  }

  /**
   * 获取可见分块数
   */
  getVisibleCellCount(projScreenMatrix: THREE.Matrix4): number {
    this.frustum.setFromProjectionMatrix(projScreenMatrix);
    return this.grid.getVisibleCellCount(this.frustum);
  }

  /** 获取空间网格 */
  getGrid(): SpatialGrid {
    return this.grid;
  }

  /** 获取总 splat 数 */
  getTotalSplats(): number {
    return this.grid.getTotalSplats();
  }
}
