/**
 * .splat 格式读取器 — 从 antimatter15/splat 格式反向加载为 GaussianCloud
 *
 * 每高斯核 32 字节:
 *   Position XYZ  3 × Float32  (12 bytes)
 *   Scale XYZ     3 × Float32  (12 bytes)
 *   Color RGBA    4 × Uint8    (4 bytes)
 *   Rotation IJKL 4 × Uint8    (4 bytes)
 *
 * [来源: splat-writer.ts — SPLAT_BYTES_PER_SPLAT = 32]
 * [来源: antimatter15/splat — github.com/antimatter15/splat]
 */

import type { GaussianCloud, GaussianSplat } from './gaussian-loader.js';
import { SPLAT_BYTES_PER_SPLAT } from './splat-writer.js';

/**
 * 从 .splat 格式 ArrayBuffer 加载为 GaussianCloud
 *
 * 将 32 字节/splat 的二进制数据反向解析为 GaussianSplat 对象数组。
 * 注意: .splat 格式不保存 SH 系数, shDegree 始终为 0。
 *
 * @param buffer .splat 文件的 ArrayBuffer
 * @param options 加载选项
 * @returns GaussianCloud
 */
export interface LoadSplatOptions {
  /** 来源描述 */
  source?: string;
}

export function loadGaussiansFromSplat(
  buffer: ArrayBuffer,
  options: LoadSplatOptions = {},
): GaussianCloud {
  const { source = 'unknown' } = options;
  const numSplats = Math.floor(buffer.byteLength / SPLAT_BYTES_PER_SPLAT);

  if (numSplats === 0) {
    return { splats: [], shDegree: 0, vertexCount: 0, source };
  }

  // 检查是否是完整数据 (字节数必须是 32 的倍数)
  const remainder = buffer.byteLength % SPLAT_BYTES_PER_SPLAT;
  if (remainder !== 0) {
    console.warn(
      `[splat-reader] 文件大小 ${buffer.byteLength} 不是 ${SPLAT_BYTES_PER_SPLAT} 的整数倍, ` +
      `尾部 ${remainder} 字节将被忽略`,
    );
  }

  const view = new DataView(buffer);
  const splats: GaussianSplat[] = [];

  for (let i = 0; i < numSplats; i++) {
    const base = i * SPLAT_BYTES_PER_SPLAT;

    // Position XYZ (3 × Float32, offset 0-11)
    const x = view.getFloat32(base + 0, true);
    const y = view.getFloat32(base + 4, true);
    const z = view.getFloat32(base + 8, true);

    // Scale XYZ (3 × Float32, offset 12-23)
    const scaleX = view.getFloat32(base + 12, true);
    const scaleY = view.getFloat32(base + 16, true);
    const scaleZ = view.getFloat32(base + 20, true);

    // Color RGBA (4 × Uint8, offset 24-27)
    const colorR = view.getUint8(base + 24) / 255;
    const colorG = view.getUint8(base + 25) / 255;
    const colorB = view.getUint8(base + 26) / 255;
    const opacity = view.getUint8(base + 27) / 255;

    // Rotation IJKL (4 × Uint8, offset 28-31)
    // (value - 128) / 128 = quaternion component
    const rotW = (view.getUint8(base + 28) - 128) / 128;
    const rotX = (view.getUint8(base + 29) - 128) / 128;
    const rotY = (view.getUint8(base + 30) - 128) / 128;
    const rotZ = (view.getUint8(base + 31) - 128) / 128;

    splats.push({
      x, y, z,
      scaleX, scaleY, scaleZ,
      rotW, rotX, rotY, rotZ,
      colorR, colorG, colorB,
      opacity,
      shDegree: 0,
    });
  }

  return {
    splats,
    shDegree: 0,
    vertexCount: numSplats,
    source,
  };
}
