/**
 * 共享类型 — 双后端 (WebGL/WebGPU) 数据契约
 *
 * ★ TD-05: SplatData 从 webgpu-render-manager.ts 私有接口提升为共享,
 *   避免双后端各写一份定义。
 * ★ TD-01: 增加 sh/shDegree 字段 — WebGPU SPZ 路径保留球谐系数。
 *   sh 为 SPZ SH 流 (非 DC 系数) 反量化结果, 顺序与 spz-writer.ts 写入一致
 *   (L1 3 个 → L2 5 个 → L3 7 个, 每 splat 每通道)。
 */

/** Splat 数据格式 (SoA 列式布局) */
export interface SplatData {
  positions: Float32Array; // 3N (x,y,z)
  scales: Float32Array; // 3N (线性空间, .splat 存储 exp 后的值)
  colors: Uint8Array; // 4N (RGBA)
  rotations: Uint8Array; // 4N (IJKL)
  /** 球谐非 DC 系数 (N × shDim × 3, 每 splat 每通道); 无 SH 时为 null/undefined */
  sh?: Float32Array | null;
  /** 球谐阶数 (0-3), 无 SH 时为 0 */
  shDegree?: number;
  count: number;
}
