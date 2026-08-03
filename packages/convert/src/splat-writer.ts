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

import type { GaussianCloud, GaussianSplat } from './gaussian-loader.js';

/** .splat 每高斯核字节数 */
export const SPLAT_BYTES_PER_SPLAT = 32;

/**
 * 将 GaussianCloud 写入 .splat 格式 ArrayBuffer
 *
 * @param cloud 高斯核集合
 * @returns 32 * splatCount 字节的 ArrayBuffer
 */
export function writeSplat(cloud: GaussianCloud): ArrayBuffer {
  const numSplats = cloud.splats.length;
  const buffer = new ArrayBuffer(numSplats * SPLAT_BYTES_PER_SPLAT);
  const view = new DataView(buffer);
  const f32 = new Float32Array(buffer);

  for (let i = 0; i < numSplats; i++) {
    const s = cloud.splats[i];
    const base = i * 8; // Float32 index (32 bytes = 8 × 4)

    // Position XYZ (3 × Float32)
    f32[base + 0] = s.x;
    f32[base + 1] = s.y;
    f32[base + 2] = s.z;

    // Scale XYZ (3 × Float32)
    f32[base + 3] = s.scaleX;
    f32[base + 4] = s.scaleY;
    f32[base + 5] = s.scaleZ;

    // Color RGBA (4 × Uint8) at byte offset 24
    const colorByteOffset = i * SPLAT_BYTES_PER_SPLAT + 24;
    view.setUint8(colorByteOffset + 0, clampU8(s.colorR * 255));
    view.setUint8(colorByteOffset + 1, clampU8(s.colorG * 255));
    view.setUint8(colorByteOffset + 2, clampU8(s.colorB * 255));
    view.setUint8(colorByteOffset + 3, clampU8(s.opacity * 255));

    // Rotation IJKL (4 × Uint8) at byte offset 28
    // (value - 128) / 128 = quaternion component
    // So: value = round(component * 128) + 128
    const rotByteOffset = i * SPLAT_BYTES_PER_SPLAT + 28;
    view.setUint8(rotByteOffset + 0, clampU8(Math.round(s.rotW * 128) + 128));
    view.setUint8(rotByteOffset + 1, clampU8(Math.round(s.rotX * 128) + 128));
    view.setUint8(rotByteOffset + 2, clampU8(Math.round(s.rotY * 128) + 128));
    view.setUint8(rotByteOffset + 3, clampU8(Math.round(s.rotZ * 128) + 128));
  }

  return buffer;
}

/** Clamp to 0-255 */
function clampU8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
