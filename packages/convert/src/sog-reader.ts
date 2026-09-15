/**
 * SOG 读取器 — 从 SOG 文件读回 GaussianCloud / GaussianCloudSoA
 *
 * 支持:
 *   - 标准 32B .splat 布局 (Position/Scale/Color/Rotation)
 *   - ★ P2-3: 紧凑 29B 布局 (3×Uint24 量化位置 + 可选 24B chunk local bbox 前缀)
 *   - ★ H2: shMode=1 时 chunk 末尾追加 SH DC (每 splat 3B, 解码时跳过 —
 *     SOG 语义上的 SH 数据仅 v3 overlay 中有, 此处不恢复 chunk DC)
 *   - ★ C-04/TD-19: v3 SH overlay (文件尾) → 完整 SH 系数恢复
 */

import { gunzipSync } from 'node:zlib';
import { parseSogMetadata, readShOverlaySoA, SOG_COMPACT_BYTES_PER_SPLAT } from './sog-writer.js';
import { SPLAT_BYTES_PER_SPLAT } from './splat-writer.js';
import { fromSoA } from './gaussian-loader.js';
import type { GaussianCloudSoA, GaussianCloud } from './gaussian-loader.js';

/** ★ M1: chunk local bbox 前缀大小 (6 × Float32) */
const CHUNK_BBOX_SIZE = 24;

/**
 * 从 SOG 文件加载 GaussianCloudSoA
 *
 * 逐 chunk 解码为列式 TypedArray。支持:
 *   - 标准 32B .splat 布局 (Position/Scale/Color/Rotation)
 *   - ★ P2-3: 紧凑 29B 布局 (3×Uint24 量化位置 + 可选 24B chunk local bbox 前缀)
 *   - ★ H2: shMode=1 时 chunk 末尾追加 SH DC (每 splat 3B, 解码时跳过 —
 *     SOG 语义上的 SH 数据仅 v3 overlay 中有, 此处不恢复 chunk DC)
 *   - ★ C-04/TD-19: v3 SH overlay (文件尾) → 完整 SH 系数恢复
 *
 * @param buffer SOG 文件的 ArrayBuffer
 * @param options 加载选项
 * @returns SoA 格式的高斯核集合
 */
export function loadGaussiansFromSogSoA(
  buffer: ArrayBuffer,
  options: { source?: string } = {},
): GaussianCloudSoA {
  const meta = parseSogMetadata(buffer);
  const { numSplats } = meta;
  const compact = meta.positionQuantization === 1;
  const bytesPerSplat = compact ? SOG_COMPACT_BYTES_PER_SPLAT : SPLAT_BYTES_PER_SPLAT;

  const positions = new Float32Array(numSplats * 3);
  const scales = new Float32Array(numSplats * 3);
  const rotations = new Float32Array(numSplats * 4);
  const colors = new Float32Array(numSplats * 3);
  const opacities = new Float32Array(numSplats);
  let splatCursor = 0;

  const bytes = new Uint8Array(buffer);
  for (const chunk of meta.chunks) {
    const raw = bytes.subarray(chunk.offset, chunk.offset + chunk.size);
    const data = meta.compression === 1 ? new Uint8Array(gunzipSync(raw)) : raw;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // ★ M1: 检测 chunk local bbox 前缀 (24 bytes = 6 × Float32)
    // 紧凑格式写入时总是附带 bbox (writeCompactSplatChunkSoA includeBbox=true);
    // 用 `>= 主体+24B` 判定, 而非 `> 主体` — 当 compact + shMode=1 (SH DC 尾部 +3B/splat)
    // 时数据天然多出 3N 字节, `>` 会把无 bbox 的 chunk 误判为有 bbox 导致 24B 错位
    const expectedDataSize = chunk.count * bytesPerSplat;
    const hasChunkBbox = compact && data.byteLength >= expectedDataSize + CHUNK_BBOX_SIZE;
    const bboxHeaderSize = hasChunkBbox ? CHUNK_BBOX_SIZE : 0;

    let bboxMin: [number, number, number] = meta.bboxMin;
    let bboxMax: [number, number, number] = meta.bboxMax;
    if (hasChunkBbox) {
      bboxMin = [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
      bboxMax = [view.getFloat32(12, true), view.getFloat32(16, true), view.getFloat32(20, true)];
    }
    const rangeX = bboxMax[0] - bboxMin[0] || 1;
    const rangeY = bboxMax[1] - bboxMin[1] || 1;
    const rangeZ = bboxMax[2] - bboxMin[2] || 1;

    for (let n = 0; n < chunk.count && splatCursor < numSplats; n++, splatCursor++) {
      const base = bboxHeaderSize + n * bytesPerSplat;
      const i3 = splatCursor * 3;
      const i4 = splatCursor * 4;
      let x: number, y: number, z: number;
      let rotBase: number, colorBase: number;

      if (compact) {
        // 紧凑 29B: Position 3×Uint24 (0-8), Scale 3×Float32 (9-20),
        //   Color RGBA (21-24), Rotation IJKL (25-28)
        const qx =
          view.getUint8(base) | (view.getUint8(base + 1) << 8) | (view.getUint8(base + 2) << 16);
        const qy =
          view.getUint8(base + 3) |
          (view.getUint8(base + 4) << 8) |
          (view.getUint8(base + 5) << 16);
        const qz =
          view.getUint8(base + 6) |
          (view.getUint8(base + 7) << 8) |
          (view.getUint8(base + 8) << 16);
        x = (qx / 0xffffff) * rangeX + bboxMin[0];
        y = (qy / 0xffffff) * rangeY + bboxMin[1];
        z = (qz / 0xffffff) * rangeZ + bboxMin[2];
        scales[i3] = view.getFloat32(base + 9, true);
        scales[i3 + 1] = view.getFloat32(base + 13, true);
        scales[i3 + 2] = view.getFloat32(base + 17, true);
        colorBase = base + 21;
        rotBase = base + 25;
      } else {
        // 标准 32B .splat: Position (0-11), Scale (12-23), Color RGBA (24-27), Rotation (28-31)
        x = view.getFloat32(base + 0, true);
        y = view.getFloat32(base + 4, true);
        z = view.getFloat32(base + 8, true);
        scales[i3] = view.getFloat32(base + 12, true);
        scales[i3 + 1] = view.getFloat32(base + 16, true);
        scales[i3 + 2] = view.getFloat32(base + 20, true);
        colorBase = base + 24;
        rotBase = base + 28;
      }

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;
      rotations[i4] = view.getUint8(rotBase + 0) / 128 - 1;
      rotations[i4 + 1] = view.getUint8(rotBase + 1) / 128 - 1;
      rotations[i4 + 2] = view.getUint8(rotBase + 2) / 128 - 1;
      rotations[i4 + 3] = view.getUint8(rotBase + 3) / 128 - 1;
      colors[i3] = view.getUint8(colorBase + 0) / 255;
      colors[i3 + 1] = view.getUint8(colorBase + 1) / 255;
      colors[i3 + 2] = view.getUint8(colorBase + 2) / 255;
      opacities[splatCursor] = view.getUint8(colorBase + 3) / 255;
    }
  }

  // ★ C-04/TD-19: v3 SH overlay → 完整 SH 系数
  const sh = readShOverlaySoA(buffer, meta);
  const shDegree = sh ? meta.shDegree : 0;

  return {
    count: numSplats,
    shDegree,
    source: options?.source ?? 'sog',
    positions,
    scales,
    rotations,
    colors,
    opacities,
    sh: sh ?? undefined,
  };
}

/**
 * 从 SOG 文件加载 GaussianCloud (AoS)
 *
 * @param buffer SOG 文件的 ArrayBuffer
 * @param options 加载选项
 * @returns AoS 格式的高斯核集合
 */
export function loadGaussiansFromSog(
  buffer: ArrayBuffer,
  options: { source?: string } = {},
): GaussianCloud {
  return fromSoA(loadGaussiansFromSogSoA(buffer, options));
}
