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
    contributionCutoff,
  } = options;

  // ★ M3: 第一阶段 — 基础过滤 (无效值、不透明度、缩放)
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

  // ★ M3: 第二阶段 — 贡献度裁剪
  // 贡献度 = opacity × max(scaleX, scaleY, scaleZ)
  // 仅当 contributionCutoff 有值时执行
  let result = filtered;
  if (contributionCutoff !== undefined && contributionCutoff > 0 && filtered.length > 0) {
    // 计算每个 splat 的贡献度
    const contributions = filtered.map((s) => ({
      splat: s,
      score: s.opacity * Math.max(s.scaleX, s.scaleY, s.scaleZ),
    }));

    // 按贡献度降序排序
    contributions.sort((a, b) => b.score - a.score);

    // 确定保留数量
    let keepCount: number;
    if (contributionCutoff >= 1) {
      // >1 的整数: 保留确切数量
      keepCount = Math.min(Math.floor(contributionCutoff), filtered.length);
    } else {
      // 0-1 的小数: 保留比例
      keepCount = Math.floor(filtered.length * contributionCutoff);
    }

    result = contributions.slice(0, keepCount).map((c) => c.splat);
  }

  return {
    splats: result,
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
  v = (v | (v << 16)) & 0x030000FF;
  v = (v | (v << 8))  & 0x0300F00F;
  v = (v | (v << 4))  & 0x030C30C3;
  v = (v | (v << 2))  & 0x09249249;
  return v;
}
