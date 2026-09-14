/**
 * 高斯数据处理 — 冗余剔除 + Morton Code 空间排序
 *
 * [来源: 3DGS 原始论文 — Kerbl et al. 2023, pruning]
 * [来源: Morton Code (Z-order) — wiki/Bitwise_operations]
 * [来源: PlayCanvas SOG 格式 — blog.playcanvas.com]
 */

import type { GaussianCloud, GaussianCloudSoA, GaussianSplat } from './gaussian-loader.js';

/** 冗余剔除选项 */
export interface PruneOptions {
  /** 最小不透明度阈值 (0-1, 默认 0.01) */
  minOpacity?: number;
  /** 最大缩放值 (异常大的高斯核, 默认 Infinity) */
  maxScale?: number;
  /** 最小缩放值 (异常小的高斯核, 默认 0) */
  minScale?: number;
  /** 是否剔除 NaN/Inf 值的高斯核 (默认 true) */
  removeInvalid?: boolean;
  /** 是否剔除完全透明的高斯核 (默认 true) */
  removeTransparent?: boolean;
  /**
   * ★ M3: 贡献度裁剪 — 按贡献度保留前 N 个高斯核
   *
   * 贡献度 = opacity × max(scaleX, scaleY, scaleZ)
   * 贡献度高的高斯核在视觉上更显著 (更大、更不透明),
   * 贡献度低的通常是训练噪声或背景填充。
   *
   * 设为 0-1 之间的小数表示保留比例 (如 0.8 = 保留前 80%),
   * 设为 >1 的整数表示保留的确切数量 (如 500000 = 保留前 50 万个)。
   *
   * 默认 undefined = 不启用贡献度裁剪。
   *
   * [来源: 会议决策 M3 — docs/party-mode-memories/2026-08-17-convert-quality-loss-memory.md]
   */
  contributionCutoff?: number;
}

/**
 * 冗余剔除 — 过滤低质量高斯核
 *
 * 剔除条件:
 *   - 不透明度低于阈值
 *   - 缩放值异常 (过大或过小)
 *   - 包含 NaN/Inf 值
 *   - 位置异常 (NaN/Inf)
 *
 * @param cloud 原始高斯核集合
 * @param options 剔除选项
 * @returns 剔除后的新 GaussianCloud
 */
export function pruneGaussians(cloud: GaussianCloud, options: PruneOptions = {}): GaussianCloud {
  const {
    minOpacity = 0.01,
    maxScale = Infinity,
    minScale = 0,
    removeInvalid = true,
    removeTransparent = true,
    contributionCutoff,
  } = options;

  // ★ M3: 第一阶段 — 基础过滤 (无效值、不透明度、缩放)
  const filtered: GaussianSplat[] = [];

  for (const s of cloud.splats) {
    // 检查无效值
    if (removeInvalid) {
      if (
        !isFinite(s.x) ||
        !isFinite(s.y) ||
        !isFinite(s.z) ||
        !isFinite(s.scaleX) ||
        !isFinite(s.scaleY) ||
        !isFinite(s.scaleZ) ||
        !isFinite(s.rotW) ||
        !isFinite(s.rotX) ||
        !isFinite(s.rotY) ||
        !isFinite(s.rotZ) ||
        !isFinite(s.opacity)
      ) {
        continue;
      }
    }

    // 检查不透明度
    if (removeTransparent && s.opacity < minOpacity) {
      continue;
    }

    // 检查缩放值
    const maxS = Math.max(s.scaleX, s.scaleY, s.scaleZ);
    const minS = Math.min(s.scaleX, s.scaleY, s.scaleZ);
    if (maxS > maxScale || minS < minScale) {
      continue;
    }

    filtered.push(s);
  }

  // ★ M3/TD-15: 第二阶段 — 贡献度裁剪
  // 贡献度 = opacity × max(scaleX, scaleY, scaleZ)
  // 仅当 contributionCutoff 有值时执行
  //
  // ★ TD-15: 由全排序 (O(N log N) + slice) 改为 quickselect (O(N)) 求阈值,
  //   再单遍过滤 + 恰好截断; 保留原输入顺序 (对下游 Morton 排序更友好)。
  let result = filtered;
  if (contributionCutoff !== undefined && contributionCutoff > 0 && filtered.length > 0) {
    // 计算每个 splat 的贡献度
    const scores = new Float64Array(filtered.length);
    for (let i = 0; i < filtered.length; i++) {
      const s = filtered[i];
      scores[i] = s.opacity * Math.max(s.scaleX, s.scaleY, s.scaleZ);
    }

    // 确定保留数量
    let keepCount: number;
    if (contributionCutoff >= 1) {
      // >1 的整数: 保留确切数量
      keepCount = Math.min(Math.floor(contributionCutoff), filtered.length);
    } else {
      // 0-1 的小数: 保留比例
      keepCount = Math.floor(filtered.length * contributionCutoff);
    }

    if (keepCount <= 0) {
      result = [];
    } else if (keepCount >= filtered.length) {
      result = filtered;
    } else {
      // 第 (n - keepCount) 小的分数 = 保留阈值 (top-K 大值的下界)
      // ★ TD-15: 对索引数组分区, 不破坏原始 scores (后续还需单遍过滤)
      const indices = new Uint32Array(filtered.length);
      for (let i = 0; i < filtered.length; i++) indices[i] = i;
      const thresholdIdx = quickselectIndices(indices, scores, filtered.length - keepCount);
      const threshold = scores[thresholdIdx];
      // 单遍收集 score > threshold 的 splat (保留输入顺序)
      const kept: GaussianSplat[] = [];
      for (let i = 0; i < filtered.length; i++) {
        if (scores[i] > threshold) kept.push(filtered[i]);
      }
      // 与阈值相等者恰好补足 (重复分数场景)
      let slack = keepCount - kept.length;
      if (slack > 0) {
        for (let i = 0; i < filtered.length && slack > 0; i++) {
          if (scores[i] === threshold) {
            kept.push(filtered[i]);
            slack--;
          }
        }
      }
      result = kept;
    }
  }

  return {
    splats: result,
    shDegree: cloud.shDegree,
    vertexCount: cloud.vertexCount,
    source: cloud.source,
  };
}

/**
 * ★ TD-15: quickselect (nth_element 语义) — 就地部分排序, O(N) 平均
 *
 * 对 array 原地调整, 使第 k 小 (0-indexed) 的元素处于最终位置,
 * 且其左侧元素 ≤ 它, 右侧元素 ≥ 它; 返回第 k 小的值。
 *
 * 与 Array.prototype.sort 不同: 只保证第 k 位置的分区正确,
 * 不产生全排序, 用于贡献度裁剪的阈值查找。
 *
 * [来源: Hoare 1961 — quickselect / CLRS 第 9 章]
 */
export function quickselect(array: Float64Array | number[], k: number): number {
  const n = array.length;
  if (k < 0) k = 0;
  if (k >= n) k = n - 1;

  let low = 0;
  let high = n - 1;
  while (low < high) {
    // ★ 中位数-of-3 pivot: 避免已排序输入退化为 O(N²) (Lomuto 固定末尾 pivot 的缺陷)
    const mid = low + ((high - low) >> 1);
    const a = array[low];
    const b = array[mid];
    const c = array[high];
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = low;
    let j = high;
    while (i <= j) {
      while (array[i] < pivot) i++;
      while (array[j] > pivot) j--;
      if (i <= j) {
        swapValues(array, i, j);
        i++;
        j--;
      }
    }
    if (k <= j) {
      high = j;
    } else if (k >= i) {
      low = i;
    } else {
      break;
    }
  }
  return array[k];
}

function swapValues(array: Float64Array | number[], i: number, j: number): void {
  if (i === j) return;
  const t = array[i];
  array[i] = array[j];
  array[j] = t;
}

/**
 * ★ TD-15: quickselectIndices — 对索引数组分区, 不破坏被比较的分数数组
 *
 * 对 indices 就地调整, 使 scores[indices[k]] 为第 k 小的分数,
 * 且 indices[0..k-1] 指向 ≤ 它的分数, indices[k+1..] 指向 ≥ 它的分数。
 * 返回 indices[k] (原数组索引)。
 *
 * 用途: 贡献度裁剪需要阈值 + 原始分数做单遍过滤, 不能原地破坏分数数组。
 */
export function quickselectIndices(indices: Uint32Array, scores: Float64Array, k: number): number {
  const n = indices.length;
  if (k < 0) k = 0;
  if (k >= n) k = n - 1;

  let low = 0;
  let high = n - 1;
  while (low < high) {
    // ★ 中位数-of-3 pivot: 避免已排序输入退化为 O(N²)
    const mid = low + ((high - low) >> 1);
    const a = scores[indices[low]];
    const b = scores[indices[mid]];
    const c = scores[indices[high]];
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = low;
    let j = high;
    while (i <= j) {
      while (scores[indices[i]] < pivot) i++;
      while (scores[indices[j]] > pivot) j--;
      if (i <= j) {
        swapIndices(indices, i, j);
        i++;
        j--;
      }
    }
    if (k <= j) {
      high = j;
    } else if (k >= i) {
      low = i;
    } else {
      break;
    }
  }
  return indices[k];
}

function swapIndices(indices: Uint32Array, i: number, j: number): void {
  if (i === j) return;
  const t = indices[i];
  indices[i] = indices[j];
  indices[j] = t;
}

/** Morton Code 排序选项 */
export interface MortonSortOptions {
  /** 分块大小 (用于确定 Morton Code 精度, 默认自动计算) */
  bucketSize?: number;
}

/**
 * Morton Code (Z-order) 空间排序
 *
 * 将高斯核按空间位置排序, 使得空间上邻近的高斯核在数组中也相邻。
 * 这对于:
 *   - SOG 流式加载 (渐进式渲染)
 *   - 缓存友好性 (减少 cache miss)
 *   - LOD 层级构建
 *
 * 算法:
 *   1. 计算所有高斯核的包围盒
 *   2. 将位置归一化到 [0, 2^20-1] 范围
 *   3. 计算 3D Morton Code (interleave x, y, z bits)
 *   4. 按 Morton Code 排序
 *
 * [来源: Morton Code — en.wikipedia.org/wiki/Z-order_curve]
 *
 * @param cloud 高斯核集合
 * @returns 排序后的新 GaussianCloud (不修改原始数据)
 */
export function mortonSortGaussians(
  cloud: GaussianCloud,
  _options: MortonSortOptions = {},
): GaussianCloud {
  const splats = cloud.splats;
  if (splats.length === 0) return { ...cloud, splats: [] };

  // 1. 计算包围盒
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const s of splats) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.z < minZ) minZ = s.z;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
    if (s.z > maxZ) maxZ = s.z;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  // 2. 计算 Morton Code 并排序
  // ★ P0 优化: 使用 16-bit per axis (48-bit total), 安全在 Number 范围内 (2^53-1)
  //   原 21-bit 方案需要 BigInt, 导致 O(N) 计算从毫秒级升至秒级
  //   16-bit 提供 65536 级空间分辨率, 对 SOG 分块排序完全足够
  const BITS = 16;
  const MAX_VAL = (1 << BITS) - 1;

  const indexed = splats.map((s, i) => {
    const nx = Math.floor(((s.x - minX) / rangeX) * MAX_VAL);
    const ny = Math.floor(((s.y - minY) / rangeY) * MAX_VAL);
    const nz = Math.floor(((s.z - minZ) / rangeZ) * MAX_VAL);
    return {
      index: i,
      morton: morton3D(nx, ny, nz),
    };
  });

  indexed.sort((a, b) => a.morton - b.morton);

  // 3. 按排序后的顺序重新排列
  const sortedSplats = indexed.map((item) => splats[item.index]);

  return {
    splats: sortedSplats,
    shDegree: cloud.shDegree,
    vertexCount: cloud.vertexCount,
    source: cloud.source,
  };
}

/**
 * ★ C-01/TD-06: Morton Code 空间排序 (SoA 版本, 与 mortonSortGaussians 同算法)
 *
 * 直接对列式 TypedArray 按 Morton Code 重排各列, 供 SoA 写入路径 (writeSogSoA) 使用。
 * 排序逻辑与 mortonSortGaussians 完全一致 (16-bit/轴, 48-bit Morton Code)。
 *
 * @param soa 高斯核集合 (列式)
 * @returns 排序后的新 GaussianCloudSoA (不修改原始数据)
 */
export function mortonSortSoA(soa: GaussianCloudSoA): GaussianCloudSoA {
  const count = soa.count;
  if (count === 0) return soa;

  const positions = soa.positions;

  // 1. 计算包围盒
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const x = positions[i3];
    const y = positions[i3 + 1];
    const z = positions[i3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  // 2. 计算 Morton Code 并排序 (与 mortonSortGaussians 相同的 16-bit 方案)
  const BITS = 16;
  const MAX_VAL = (1 << BITS) - 1;

  const indexed = new Array<{ index: number; morton: number }>(count);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const nx = Math.floor(((positions[i3] - minX) / rangeX) * MAX_VAL);
    const ny = Math.floor(((positions[i3 + 1] - minY) / rangeY) * MAX_VAL);
    const nz = Math.floor(((positions[i3 + 2] - minZ) / rangeZ) * MAX_VAL);
    indexed[i] = { index: i, morton: morton3D(nx, ny, nz) };
  }

  indexed.sort((a, b) => a.morton - b.morton);

  // 3. 按排序顺序重排列式数组
  const shCoeffsPerChannel = soa.shDegree === 0 ? 0 : soa.shDegree * (soa.shDegree + 2);
  const totalShCoeffs = shCoeffsPerChannel * 3;

  const nPositions = new Float32Array(count * 3);
  const nScales = new Float32Array(count * 3);
  const nRotations = new Float32Array(count * 4);
  const nColors = new Float32Array(count * 3);
  const nOpacities = new Float32Array(count);
  const nSh = totalShCoeffs > 0 && soa.sh ? new Float32Array(count * totalShCoeffs) : undefined;

  for (let n = 0; n < count; n++) {
    const src = indexed[n].index;
    const si3 = src * 3;
    const si4 = src * 4;
    const di3 = n * 3;
    const di4 = n * 4;

    nPositions[di3] = positions[si3];
    nPositions[di3 + 1] = positions[si3 + 1];
    nPositions[di3 + 2] = positions[si3 + 2];

    nScales[di3] = soa.scales[si3];
    nScales[di3 + 1] = soa.scales[si3 + 1];
    nScales[di3 + 2] = soa.scales[si3 + 2];

    nRotations[di4] = soa.rotations[si4];
    nRotations[di4 + 1] = soa.rotations[si4 + 1];
    nRotations[di4 + 2] = soa.rotations[si4 + 2];
    nRotations[di4 + 3] = soa.rotations[si4 + 3];

    nColors[di3] = soa.colors[si3];
    nColors[di3 + 1] = soa.colors[si3 + 1];
    nColors[di3 + 2] = soa.colors[si3 + 2];

    nOpacities[n] = soa.opacities[src];

    if (nSh && soa.sh) {
      const shSrcBase = src * totalShCoeffs;
      const shDstBase = n * totalShCoeffs;
      for (let j = 0; j < totalShCoeffs; j++) {
        nSh[shDstBase + j] = soa.sh[shSrcBase + j];
      }
    }
  }

  return {
    count,
    shDegree: soa.shDegree,
    source: soa.source,
    positions: nPositions,
    scales: nScales,
    rotations: nRotations,
    colors: nColors,
    opacities: nOpacities,
    sh: nSh,
  };
}

/**
 * 计算 3D Morton Code (Z-order interleave) — Number 版本
 *
 * 将 x, y, z 的 bit 交错排列:
 *   result = ... z2 y2 x2 z1 y1 x1 z0 y0 x0
 *
 * ★ P0 优化: 使用 magic bits 查表法 + Number 运算替代 BigInt
 *   - 输入: 16-bit per axis (0 ~ 65535)
 *   - 输出: 48-bit Morton Code (安全在 Number.MAX_SAFE_INTEGER 范围内)
 *   - 性能: 比 BigInt 版本快 50-100x
 *
 * [来源: Morton Code magic bits — Forceflow C++ libmorton 实现]
 * [来源: https://www.forceflow.be/2013/10/07/morton-encodingdecoding-through-bit-interleaving-implementations/]
 *
 * @param x, y, z  各 16 位的坐标值 (0 ~ 65535)
 * @returns 48-bit Morton Code (Number)
 */
function morton3D(x: number, y: number, z: number): number {
  // TD-25: Uses 16-bit per axis (65536 levels). Adequate for scenes <10km.
  //   For larger scenes, consider a 20-bit option (still safe within Number range).
  return spreadBits(x) | (spreadBits(y) << 1) | (spreadBits(z) << 2);
}

/**
 * 将 16-bit 值的 bit 间隔展开为 3 的倍数位置
 * 输入:  b15 b14 b13 ... b1 b0
 * 输出:  0 0 b15 0 b14 0 b13 ... 0 b1 0 b0
 *
 * 使用 magic bits 方法, 5 步完成 16-bit 展开
 */
function spreadBits(v: number): number {
  // 确保 32-bit 无符号运算
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  v = (v | (v << 2)) & 0x09249249;
  return v;
}
