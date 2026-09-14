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

import type { GaussianCloud, GaussianCloudSoA } from './gaussian-loader.js';
import { fromSoA } from './gaussian-loader.js';
import { SPLAT_BYTES_PER_SPLAT } from './splat-writer.js';

/**
 * 从 .splat 格式 ArrayBuffer 加载为 GaussianCloud
 *
 * 将 32 字节/splat 的二进制数据反向解析为 GaussianSplat 对象数组。
 * 注意: .splat 格式不保存 SH 系数, shDegree 始终为 0。
 *
 * ★ C-01/TD-06: 内部委托 loadGaussiansFromSplatSoA + fromSoA (单一实现, 避免两套逻辑漂移)。
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
  return fromSoA(loadGaussiansFromSplatSoA(buffer, options));
}

/**
 * ★ C-01/TD-06: 从 .splat 格式 ArrayBuffer 直接加载为 GaussianCloudSoA (列式)
 *
 * 直接读取到 TypedArray, 跳过 GaussianSplat 对象数组。
 *
 * @param buffer .splat 文件的 ArrayBuffer
 * @param options 加载选项
 * @returns GaussianCloudSoA
 */
export function loadGaussiansFromSplatSoA(
  buffer: ArrayBuffer,
  options: LoadSplatOptions = {},
): GaussianCloudSoA {
  const { source = 'unknown' } = options;
  const numSplats = Math.floor(buffer.byteLength / SPLAT_BYTES_PER_SPLAT);

  if (numSplats === 0) {
    return {
      count: 0,
      shDegree: 0,
      source,
      positions: new Float32Array(0),
      scales: new Float32Array(0),
      rotations: new Float32Array(0),
      colors: new Float32Array(0),
      opacities: new Float32Array(0),
    };
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
  const positions = new Float32Array(numSplats * 3);
  const scales = new Float32Array(numSplats * 3);
  const rotations = new Float32Array(numSplats * 4);
  const colors = new Float32Array(numSplats * 3);
  const opacities = new Float32Array(numSplats);

  for (let i = 0; i < numSplats; i++) {
    const base = i * SPLAT_BYTES_PER_SPLAT;
    const i3 = i * 3;
    const i4 = i * 4;

    // Position XYZ (3 × Float32, offset 0-11)
    positions[i3] = view.getFloat32(base + 0, true);
    positions[i3 + 1] = view.getFloat32(base + 4, true);
    positions[i3 + 2] = view.getFloat32(base + 8, true);

    // Scale XYZ (3 × Float32, offset 12-23)
    scales[i3] = view.getFloat32(base + 12, true);
    scales[i3 + 1] = view.getFloat32(base + 16, true);
    scales[i3 + 2] = view.getFloat32(base + 20, true);

    // Color RGBA (4 × Uint8, offset 24-27)
    colors[i3] = view.getUint8(base + 24) / 255;
    colors[i3 + 1] = view.getUint8(base + 25) / 255;
    colors[i3 + 2] = view.getUint8(base + 26) / 255;
    opacities[i] = view.getUint8(base + 27) / 255;

    // Rotation IJKL (4 × Uint8, offset 28-31)
    // (value - 128) / 128 = quaternion component
    rotations[i4] = (view.getUint8(base + 28) - 128) / 128;
    rotations[i4 + 1] = (view.getUint8(base + 29) - 128) / 128;
    rotations[i4 + 2] = (view.getUint8(base + 30) - 128) / 128;
    rotations[i4 + 3] = (view.getUint8(base + 31) - 128) / 128;
  }

  return {
    count: numSplats,
    shDegree: 0,
    source,
    positions,
    scales,
    rotations,
    colors,
    opacities,
  };
}
