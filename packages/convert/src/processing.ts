/**
 * 高斯数据处理 — 冗余剔除 + Morton Code 空间排序
 *
 * [来源: 3DGS 原始论文 — Kerbl et al. 2023, pruning]
 * [来源: Morton Code (Z-order) — wiki/Bitwise_operations]
 * [来源: PlayCanvas SOG 格式 — blog.playcanvas.com]
 */

import type { GaussianCloud, GaussianSplat } from './gaussian-loader.js';

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
export function pruneGaussians(
  cloud: GaussianCloud,
  options: PruneOptions = {},
): GaussianCloud {
  const {
    minOpacity = 0.01,
    maxScale = Infinity,
    minScale = 0,
    removeInvalid = true,
    removeTransparent = true,
  } = options;

  const filtered: GaussianSplat[] = [];
  

  for (const s of cloud.splats) {
    // 检查无效值
    if (removeInvalid) {
      if (!isFinite(s.x) || !isFinite(s.y) || !isFinite(s.z) ||
          !isFinite(s.scaleX) || !isFinite(s.scaleY) || !isFinite(s.scaleZ) ||
          !isFinite(s.rotW) || !isFinite(s.rotX) || !isFinite(s.rotY) || !isFinite(s.rotZ) ||
          !isFinite(s.opacity)) {
        
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

  return {
    splats: filtered,
    shDegree: cloud.shDegree,
    vertexCount: cloud.vertexCount,
    source: cloud.source,
  };
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
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

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
  // 使用 21-bit per axis (63-bit total), 足够覆盖大场景
  const BITS = 21;
  const MAX_VAL = (1 << BITS) - 1;

  const indexed = splats.map((s, i) => {
    const nx = Math.floor(((s.x - minX) / rangeX) * MAX_VAL);
    const ny = Math.floor(((s.y - minY) / rangeY) * MAX_VAL);
    const nz = Math.floor(((s.z - minZ) / rangeZ) * MAX_VAL);
    return {
      index: i,
      morton: morton3D(nx, ny, nz, BITS),
    };
  });

  indexed.sort((a, b) => {
    if (a.morton < b.morton) return -1;
    if (a.morton > b.morton) return 1;
    return 0;
  });

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
 * 计算 3D Morton Code (Z-order interleave)
 *
 * 将 x, y, z 的 bit 交错排列:
 *   result = ... z2 y2 x2 z1 y1 x1 z0 y0 x0
 *
 * 使用 magic bits 方法高效计算
 *
 * @param x, y, z  各 BITS 位的坐标值
 * @param bits     每个坐标的位数 (最大 21)
 */
function morton3D(x: number, y: number, z: number, bits: number): bigint {
  let result = 0n;
  for (let i = 0; i < bits; i++) {
    result |= BigInt((x >> i) & 1) << BigInt(i * 3);
    result |= BigInt((y >> i) & 1) << BigInt(i * 3 + 1);
    result |= BigInt((z >> i) & 1) << BigInt(i * 3 + 2);
  }
  return result;
}
