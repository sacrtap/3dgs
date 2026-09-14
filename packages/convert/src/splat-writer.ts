/**
 * .splat 格式写入器 — antimatter15/splat 格式
 *
 * 每高斯核 32 字节:
 *   Position XYZ  3 × Float32  (12 bytes)
 *   Scale XYZ     3 × Float32  (12 bytes)
 *   Color RGBA    4 × Uint8    (4 bytes)
 *   Rotation IJKL 4 × Uint8    (4 bytes)
 *
 * 旋转存储为 uint8, (value - 128) / 128 得到归一化四元数分量
 * 颜色存储为 uint8 (0-255), Alpha = opacity * 255
 *
 * [来源: Spark 源码 — SplatParser.RowSizeBytes = 32, node_modules/@sparkjsdev/spark/dist/spark.module.js:4225]
 * [来源: antimatter15/splat — github.com/antimatter15/splat]
 */

import type { GaussianCloud, GaussianCloudSoA } from './gaussian-loader.js';
import { toSoA } from './gaussian-loader.js';

/** .splat 每高斯核字节数 */
export const SPLAT_BYTES_PER_SPLAT = 32;

/**
 * 将 GaussianCloud 写入 .splat 格式 ArrayBuffer
 *
 * ★ C-01/TD-06: 内部委托 writeSplatSoA + toSoA (单一实现, 保证 AoS/SoA 产物 byte 级一致)。
 *
 * @param cloud 高斯核集合
 * @returns 32 * splatCount 字节的 ArrayBuffer
 */
export function writeSplat(cloud: GaussianCloud): ArrayBuffer {
  return writeSplatSoA(toSoA(cloud));
}

/**
 * ★ C-01/TD-06: 将 GaussianCloudSoA 写入 .splat 格式 ArrayBuffer
 *
 * @param soa 高斯核集合 (列式)
 * @param start 起始索引 (含, 默认 0) — 供 chunk 切片复用
 * @param end 结束索引 (不含, 默认 soa.count)
 * @returns 32 * (end - start) 字节的 ArrayBuffer
 */
export function writeSplatSoA(soa: GaussianCloudSoA, start = 0, end = soa.count): ArrayBuffer {
  const count = end - start;
  const buffer = new ArrayBuffer(count * SPLAT_BYTES_PER_SPLAT);
  const view = new DataView(buffer);
  const f32 = new Float32Array(buffer);

  for (let n = 0; n < count; n++) {
    const i = start + n;
    const i3 = i * 3;
    const i4 = i * 4;
    const base = n * 8; // Float32 index (32 bytes = 8 × 4)

    // Position XYZ (3 × Float32)
    f32[base + 0] = soa.positions[i3];
    f32[base + 1] = soa.positions[i3 + 1];
    f32[base + 2] = soa.positions[i3 + 2];

    // Scale XYZ (3 × Float32)
    f32[base + 3] = soa.scales[i3];
    f32[base + 4] = soa.scales[i3 + 1];
    f32[base + 5] = soa.scales[i3 + 2];

    // Color RGBA (4 × Uint8) at byte offset 24
    const colorByteOffset = n * SPLAT_BYTES_PER_SPLAT + 24;
    view.setUint8(colorByteOffset + 0, clampU8(soa.colors[i3] * 255));
    view.setUint8(colorByteOffset + 1, clampU8(soa.colors[i3 + 1] * 255));
    view.setUint8(colorByteOffset + 2, clampU8(soa.colors[i3 + 2] * 255));
    view.setUint8(colorByteOffset + 3, clampU8(soa.opacities[i] * 255));

    // Rotation IJKL (4 × Uint8) at byte offset 28
    const rotByteOffset = n * SPLAT_BYTES_PER_SPLAT + 28;
    view.setUint8(rotByteOffset + 0, clampU8(Math.round(soa.rotations[i4] * 128) + 128));
    view.setUint8(rotByteOffset + 1, clampU8(Math.round(soa.rotations[i4 + 1] * 128) + 128));
    view.setUint8(rotByteOffset + 2, clampU8(Math.round(soa.rotations[i4 + 2] * 128) + 128));
    view.setUint8(rotByteOffset + 3, clampU8(Math.round(soa.rotations[i4 + 3] * 128) + 128));
  }

  return buffer;
}

/** Clamp to 0-255 */
function clampU8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
