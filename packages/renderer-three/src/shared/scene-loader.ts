/**
 * 共享场景加载工具 — 降采样 + SOG chunk 收集
 *
 * ★ TD-08: 双后端 (WebGL/WebGPU) 重复加载逻辑抽取。
 *   1. downsampleSplatBytes — .splat 32B/splat 字节级均匀降采样 (WebGL 路径)
 *   2. loadSogChunks — SOG 流式 chunk 收集 + Worker 拼接 (两端共用)
 *
 * 设计约束:
 *   - 降采样为"每隔 K 取 1"的均匀采样, 保持空间覆盖均匀
 *     (splat 顺序为训练序/非空间排序, 直接截断会产生空间空洞)
 *   - buffer pool 语义由调用方注入 (D-10: 归还已发放缓冲)
 *   - 本模块不依赖 WebGL/WebGPU 具体实现, 纯数据操作
 */

import { SogStreamer, type SogMetadata } from '../sog-streamer.js';
import { concatChunksInWorker } from '../sog-concat-worker.js';
import type { SplatData } from './types.js';

// ─── 降采样 ─────────────────────────────────────────────────

/** 缓冲池注入接口 — 由调用方提供, 保持 D-10 的池归还语义 */
export interface DownsamplePool {
  /** 获取至少 bytes 字节的 ArrayBuffer */
  acquire(bytes: number): ArrayBuffer;
  /** 登记发放的缓冲, 供场景切换/销毁时归还 */
  track(buffer: ArrayBuffer): void;
}

/** 降采样结果 */
export interface DownsampleResult {
  /** 采样后的数据 (未超限时为原引用, 不拷贝) */
  data: Uint8Array;
  /** 采样后 splat 数 */
  sampled: number;
  /** 原始 splat 数 */
  total: number;
}

/**
 * .splat 字节级均匀降采样
 *
 * @param fullData 完整 .splat 字节 (32B/splat)
 * @param maxSplats 上限; 未超限时原样返回 (不拷贝)
 * @param pool 可选缓冲池 (WebGL 路径注入, 复用 ArrayBuffer 减少 GC)
 * @param logLabel 可选日志标签 (如 'SOG 降采样'), 为空则不输出日志
 */
export function downsampleSplatBytes(
  fullData: Uint8Array,
  maxSplats: number,
  pool?: DownsamplePool,
  logLabel?: string,
): DownsampleResult {
  const total = Math.floor(fullData.byteLength / 32);

  if (total <= maxSplats) {
    return { data: fullData, sampled: total, total };
  }

  const step = total / maxSplats;
  const sampled = Math.floor(total / step);
  const sampledData = pool
    ? new Uint8Array(pool.acquire(sampled * 32))
    : new Uint8Array(sampled * 32);
  if (pool) {
    pool.track(sampledData.buffer);
  }

  for (let i = 0; i < sampled; i++) {
    const srcOffset = Math.floor(i * step) * 32;
    const dstOffset = i * 32;
    sampledData.set(fullData.subarray(srcOffset, srcOffset + 32), dstOffset);
  }

  if (logLabel) {
    console.info(
      `[RenderManager] ${logLabel}: ${sampled.toLocaleString()} / ${total.toLocaleString()} splats ` +
        `(step=${step.toFixed(2)}, 保留 ${((sampled / total) * 100).toFixed(1)}%)`,
    );
  }

  return { data: sampledData, sampled, total };
}

/**
 * SoA 级均匀降采样 (WebGPU 路径) — 与 downsampleSplatBytes 语义一致
 *
 * @param data 输入 SplatData (SoA)
 * @param maxCount 上限; 未超限时原样返回
 */
export function downsampleSplatData(data: SplatData, maxCount: number): SplatData {
  if (data.count <= maxCount) {
    return data;
  }

  const step = data.count / maxCount;
  const newCount = Math.floor(data.count / step);

  const positions = new Float32Array(newCount * 3);
  const scales = new Float32Array(newCount * 3);
  const colors = new Uint8Array(newCount * 4);
  const rotations = new Uint8Array(newCount * 4);
  // ★ TD-01: SH 系数随降采样同步 (每 splat shDim*3 个)
  const shDim = data.sh ? Math.floor(data.sh.length / data.count / 3) : 0;
  const sh = data.sh ? new Float32Array(newCount * shDim * 3) : null;

  for (let i = 0; i < newCount; i++) {
    const src = Math.floor(i * step);
    positions.set(data.positions.subarray(src * 3, src * 3 + 3), i * 3);
    scales.set(data.scales.subarray(src * 3, src * 3 + 3), i * 3);
    colors.set(data.colors.subarray(src * 4, src * 4 + 4), i * 4);
    rotations.set(data.rotations.subarray(src * 4, src * 4 + 4), i * 4);
    if (sh && data.sh) {
      sh.set(data.sh.subarray(src * shDim * 3, src * shDim * 3 + shDim * 3), i * shDim * 3);
    }
  }

  return { positions, scales, colors, rotations, sh, shDegree: data.shDegree, count: newCount };
}

// ─── SOG chunk 收集 ─────────────────────────────────────────

/** SOG 加载回调 */
export interface SogChunkHandlers {
  /** 进度回调 — 参数为 splat 数 (SOG 语义) */
  onProgress?: (loaded: number, total: number) => void;
  /** 每个 chunk 到达时回调 (调用方可用于首帧增量渲染) */
  onChunkLoaded?: (chunkIndex: number, data: ArrayBuffer) => void;
  /** chunk 加载错误回调 */
  onError?: (error: Error) => void;
}

/** SOG chunk 收集结果 */
export interface LoadSogChunksResult {
  /** 拼接后的完整 .splat 字节 (Morton 排序) */
  fullData: Uint8Array;
  /** SOG 元数据 (numSplats/numChunks/compression/lodLevels 等) */
  metadata: SogMetadata;
  /** SogStreamer 实例 — 调用方持有用于 abort */
  streamer: SogStreamer;
}

/**
 * SOG 流式加载 — 并行拉取全部 chunk 并在 Worker 中拼接
 *
 * 两端 (WebGL/WebGPU) 共用的 chunk 收集阶段; mesh 创建/数据上传等
 * 后端差异部分由调用方在返回后自行处理。
 *
 * @param url SOG 资源地址
 * @param maxSplats 早期终止阈值 (P2: 只加载足够提供 maxSplats 的前 N 个 chunk)
 * @param handlers 进度/chunk/错误回调
 */
export async function loadSogChunks(
  url: string,
  maxSplats: number,
  handlers: SogChunkHandlers = {},
): Promise<LoadSogChunksResult> {
  const chunkDataList: ArrayBuffer[] = [];

  const streamer = new SogStreamer({
    url,
    parallel: true,
    parallelCount: 4,
    // ★ P2: 早期终止加载 — SOG 数据 Morton 排序, 前 N 个 chunk 空间均匀
    maxSplats,
    onProgress: (_loadedChunks, _totalChunks, loadedSplats, totalSplats) => {
      if (handlers.onProgress) {
        handlers.onProgress(loadedSplats, totalSplats);
      }
    },
    onChunkLoaded: (chunkIndex, data) => {
      chunkDataList[chunkIndex] = data;
      handlers.onChunkLoaded?.(chunkIndex, data);
    },
    onError: (error) => {
      handlers.onError?.(error);
    },
  });

  const metadata = await streamer.start();

  const fullBuffer = await concatChunksInWorker(chunkDataList);
  return { fullData: new Uint8Array(fullBuffer), metadata, streamer };
}
