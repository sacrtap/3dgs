/**
 * SOG 流式 LOD 客户端 — 分块加载管理器
 *
 * 从 SOG 文件流式加载高斯核数据, 支持渐进式渲染。
 *
 * ★ P1-2: 支持 gzip 压缩 chunk (SOG v2)
 * ★ P1-3: 读取 LOD 元数据 (lodQuality)
 *
 * 工作流程:
 *   1. 获取 SOG 文件 header (前 64 字节) → 获取 numChunks, chunkSize, compression
 *   2. 获取 chunk index (numChunks × 8 字节)
 *   3. 并行加载各 chunk (使用 HTTP Range 请求)
 *   4. 若 compression=1, 使用 DecompressionStream 解压 chunk
 *   5. 前面的 chunk 先加载渲染, 后面的 chunk 逐步补充细节
 *
 * [来源: 项目源码 — packages/convert/src/sog-writer.ts]
 * [来源: PlayCanvas SOG 流式 — blog.playcanvas.com]
 * [来源: DecompressionStream — developer.mozilla.org/en-US/docs/Web/API/DecompressionStream]
 */

/** SOG chunk 索引条目 (本地定义, 避免 cross-package 依赖) */
export interface SogChunkEntry {
  /** chunk 在文件中的字节偏移 */
  offset: number;
  /** chunk 数据的字节大小 (压缩后) */
  size: number;
  /** chunk 中的 splat 数 */
  count: number;
}

/** SOG 文件元数据 (本地定义, 避免 cross-package 依赖) */
export interface SogMetadata {
  numSplats: number;
  numChunks: number;
  chunkSize: number;
  shDegree: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  chunks: SogChunkEntry[];
  /** ★ P1-2: 压缩方式 (0=none, 1=gzip) */
  compression: number;
  /** ★ M2: LOD 树偏移 (0 = 无预构建 LOD) */
  lodTreeOffset: number;
  /** ★ M2: LOD 树大小 (0 = 无预构建 LOD) */
  lodTreeSize: number;
  /** ★ P1-3: LOD 质量 (0=fast, 1=quality) */
  lodQuality: number;
  /** ★ P2-3: 位置量化 (0=off, 1=24-bit) */
  positionQuantization: number;
  /** ★ 格式版本 */
  version: number;
  /**
   * ★ M2: 预构建 LOD 层级 (累计 splat 数)
   *
   * 若 lodTreeSize > 0, 包含每个 LOD 层级的累计 splat 数。
   * levels[0] = 最粗 LOD, levels[last] = 全部 splat。
   * 若 lodTreeSize = 0, 为 undefined (需运行时构建)。
   */
  lodLevels?: number[];
  /** ★ M2: LOD 缩减因子 (1.5=fast, 1.75=quality) */
  lodBase?: number;
}

/** SOG 流式加载选项 */
export interface SogStreamerOptions {
  /** SOG 文件 URL */
  url: string;
  /** 加载进度回调 */
  onProgress?: (loadedChunks: number, totalChunks: number, loadedSplats: number, totalSplats: number) => void;
  /** chunk 加载完成回调 (返回该 chunk 的 **解压后** splat 数据) */
  onChunkLoaded?: (chunkIndex: number, data: ArrayBuffer, count: number) => void;
  /** 所有 chunk 加载完成回调 */
  onComplete?: () => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 是否并行加载多个 chunk (默认 true, 并行加载以加速首帧) */
  parallel?: boolean;
  /** 并行加载数量 (默认 4, 匹配浏览器 HTTP/2 并发上限) */
  parallelCount?: number;
  /**
   * ★ P2: 最大 splat 数 — 早期终止加载
   *
   * SOG 数据是 Morton 排序的, 前 N 个 chunk 包含空间均匀分布的子集。
   * 设置此参数后, SogStreamer 只加载足够提供 maxSplats 个 splat 的前 N 个 chunk,
   * 跳过剩余 chunk, 大幅减少下载量和加载时间。
   *
   * 例如: Garden 5.83M splats / 357 chunks, maxSplats=500K → 只需 31 chunks (8.7%)
   *
   * 若不设置或 >= numSplats, 加载所有 chunk。
   */
  maxSplats?: number;
}

/** SOG v1 魔数 */
const SOG_MAGIC_V1 = 0x31474F53; // "SOG1"

/** SOG v2 魔数 */
const SOG_MAGIC_V2 = 0x32474F53; // "SOG2"

/** Header 大小 */
const SOG_HEADER_SIZE = 64;

/** 压缩常量 */
const COMPRESSION_NONE = 0;
const COMPRESSION_GZIP = 1;

/** ★ P2-3: 位置量化常量 */
const POSITION_QUANT_OFF = 0;
const POSITION_QUANT_24BIT = 1;

/** ★ P2-3: 紧凑格式每 splat 字节数 */
const COMPACT_BYTES_PER_SPLAT = 29;

/** ★ P2-3: .splat 格式每 splat 字节数 */
const SPLAT_BYTES_PER_SPLAT = 32;

/** ★ P2-3: 24-bit 量化最大值 */
const QUANT_MAX = 0xFFFFFF;

/** ★ M2: LOD 树二进制头大小 (numLevels: 4B + lodBase: 4B = 8B) */
const LOD_TREE_HEADER_SIZE = 8;

export class SogStreamer {
  private options: SogStreamerOptions;
  private metadata: SogMetadata | null = null;
  private loadedChunks: Set<number> = new Set();
  private aborted = false;
  /** ★ C2: AbortController 用于中断正在进行的 fetch 请求 */
  private _abortController?: AbortController;
  /** ★ P2: 早期终止加载 — 最多加载的 chunk 数 (基于 maxSplats 计算) */
  private _maxChunksToLoad: number = Infinity;

  constructor(options: SogStreamerOptions) {
    this.options = options;
  }

  /**
   * 开始流式加载
   *
   * 1. 获取 header + chunk index
   * 2. 并行加载 chunk (含 gzip 解压)
   */
  async start(): Promise<SogMetadata> {
    // ★ C2: 创建 AbortController, 用于中断所有后续 fetch 请求
    this._abortController = new AbortController();

    // 1. 获取 header (64 bytes)
    const headerBuffer = await this.fetchRange(0, SOG_HEADER_SIZE);
    this.metadata = this.parseHeader(headerBuffer);

    // 2. 获取 chunk index
    const indexSize = this.metadata.numChunks * 8;
    const indexBuffer = await this.fetchRange(SOG_HEADER_SIZE, SOG_HEADER_SIZE + indexSize);
    this.parseChunkIndex(indexBuffer, this.metadata);

    // ★ M2: 获取预构建 LOD 树数据 (如果存在)
    if (this.metadata.lodTreeOffset > 0 && this.metadata.lodTreeSize > 0) {
      try {
        const lodTreeBuffer = await this.fetchRange(
          this.metadata.lodTreeOffset,
          this.metadata.lodTreeOffset + this.metadata.lodTreeSize,
        );
        this.parseLodTree(lodTreeBuffer, this.metadata);
      } catch (err) {
        // LOD 树获取失败不阻断加载, 回退到运行时构建
        console.warn('[SogStreamer] LOD 树数据获取失败, 回退到运行时构建:', err);
      }
    }

    // ★ P2: 早期终止加载 — 计算 maxChunksToLoad
    if (this.options.maxSplats && this.options.maxSplats < this.metadata.numSplats) {
      let accumulated = 0;
      this._maxChunksToLoad = 0;
      for (const chunk of this.metadata.chunks) {
        accumulated += chunk.count;
        this._maxChunksToLoad++;
        if (accumulated >= this.options.maxSplats) break;
      }
      console.info(
        `[SogStreamer] P2 早期终止: 加载 ${this._maxChunksToLoad}/${this.metadata.numChunks} chunks ` +
        `(目标 ${this.options.maxSplats.toLocaleString()} / 总量 ${this.metadata.numSplats.toLocaleString()} splats, ` +
        `预计 ${(accumulated).toLocaleString()} splats, ` +
        `节省 ${((1 - this._maxChunksToLoad / this.metadata.numChunks) * 100).toFixed(1)}% 下载量)`,
      );
    }

    // 3. 加载 chunk
    // ★ P0-1: 默认启用并行加载 (除非显式 parallel: false)
    if (this.options.parallel !== false) {
      await this.loadChunksParallel();
    } else {
      await this.loadChunksSequential();
    }

    this.options.onComplete?.();
    return this.metadata;
  }

  /**
   * 中止加载
   *
   * ★ C2: 使用 AbortController 中断正在进行的 fetch 请求,
   *   防止旧场景的 chunk 回调污染新场景。
   *
   * [来源: AbortController — developer.mozilla.org/en-US/docs/Web/API/AbortController]
   */
  abort(): void {
    this.aborted = true;
    this._abortController?.abort();
  }

  /** 获取元数据 (需在 start() 后调用) */
  getMetadata(): SogMetadata | null {
    return this.metadata;
  }

  /** 获取已加载的 chunk 数 */
  getLoadedChunkCount(): number {
    return this.loadedChunks.size;
  }

  // ── 内部方法 ──

  /**
   * 使用 HTTP Range 请求获取部分数据
   *
   * ★ C2: 传入 AbortSignal, abort() 时自动中断正在进行的请求
   */
  private async fetchRange(start: number, end: number): Promise<ArrayBuffer> {
    const response = await fetch(this.options.url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      signal: this._abortController?.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: 无法获取 SOG 数据 (Range 请求)`);
    }

    return response.arrayBuffer();
  }

  /** 解析 SOG header (支持 v1 和 v2) */
  private parseHeader(buffer: ArrayBuffer): SogMetadata {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);

    let version: number;
    let compression = COMPRESSION_NONE;
    let lodQuality = 0;
    let positionQuantization = POSITION_QUANT_OFF;

    if (magic === SOG_MAGIC_V2) {
      // ★ SOG v2
      version = 2;
      compression = view.getUint8(7);
      lodQuality = view.getUint8(52);
      // ★ P2-3: 读取位置量化标志 (byte 53)
      positionQuantization = view.getUint8(53);
    } else if (magic === SOG_MAGIC_V1) {
      // ★ SOG v1 (向后兼容)
      version = 1;
    } else {
      throw new Error(`无效的 SOG 文件: magic 不匹配 (0x${magic.toString(16)})`);
    }

    const versionField = view.getUint16(4, true);
    if (versionField !== version) {
      throw new Error(`SOG 版本不匹配: 期望 ${version}, 得到 ${versionField}`);
    }

    const shDegree = view.getUint8(6);
    const numSplats = view.getUint32(8, true);
    const numChunks = view.getUint32(12, true);
    const chunkSize = view.getUint32(16, true);

    // ★ C3: 输入验证 — 防止恶意/损坏的文件导致静默错误或 OOM
    if (numSplats === 0) {
      throw new Error('无效的 SOG 文件: numSplats = 0');
    }
    if (numSplats > 100_000_000) {
      throw new Error(`SOG numSplats 过大: ${numSplats.toLocaleString()} (上限 100M), 可能导致 OOM`);
    }
    if (numChunks === 0) {
      throw new Error('无效的 SOG 文件: numChunks = 0');
    }
    if (numChunks > 10_000) {
      throw new Error(`SOG numChunks 过大: ${numChunks} (上限 10000)`);
    }
    if (compression > 1) {
      throw new Error(`无效的 SOG compression 值: ${compression} (仅支持 0=none, 1=gzip)`);
    }
    if (positionQuantization > 1) {
      throw new Error(`无效的 SOG positionQuantization 值: ${positionQuantization} (仅支持 0=off, 1=24bit)`);
    }

    // ★ M2: 读取 LOD 树偏移和大小
    let lodTreeOffset = 0;
    let lodTreeSize = 0;
    if (magic === SOG_MAGIC_V2) {
      lodTreeOffset = view.getUint32(44, true);
      lodTreeSize = view.getUint32(48, true);
    }

    const bboxMin: [number, number, number] = [
      view.getFloat32(20, true),
      view.getFloat32(24, true),
      view.getFloat32(28, true),
    ];
    const bboxMax: [number, number, number] = [
      view.getFloat32(32, true),
      view.getFloat32(36, true),
      view.getFloat32(40, true),
    ];

    return {
      numSplats,
      numChunks,
      chunkSize,
      shDegree,
      bboxMin,
      bboxMax,
      chunks: [],
      compression,
      lodTreeOffset,
      lodTreeSize,
      lodQuality,
      positionQuantization,
      version,
    };
  }

  /** 解析 chunk index */
  private parseChunkIndex(buffer: ArrayBuffer, meta: SogMetadata): void {
    const view = new DataView(buffer);
    for (let c = 0; c < meta.numChunks; c++) {
      const base = c * 8;
      meta.chunks.push({
        offset: view.getUint32(base, true),
        size: view.getUint32(base + 4, true),
        count: Math.min(meta.chunkSize, meta.numSplats - c * meta.chunkSize),
      });
    }
  }

  /**
   * ★ M2: 解析预构建 LOD 树数据
   *
   * 二进制格式:
   *   numLevels  Uint32    — LOD 层级数
   *   lodBase    Float32   — LOD 缩减因子
   *   levels     numLevels × Uint32 — 每个 LOD 层级的累计 splat 数
   */
  private parseLodTree(buffer: ArrayBuffer, meta: SogMetadata): void {
    if (buffer.byteLength < LOD_TREE_HEADER_SIZE) {
      console.warn('[SogStreamer] LOD 树数据过小, 跳过');
      return;
    }

    const view = new DataView(buffer);
    const numLevels = view.getUint32(0, true);
    const lodBase = view.getFloat32(4, true);

    if (numLevels === 0 || numLevels > 100) {
      console.warn(`[SogStreamer] LOD 树 numLevels 异常: ${numLevels}, 跳过`);
      return;
    }

    const expectedSize = LOD_TREE_HEADER_SIZE + numLevels * 4;
    if (buffer.byteLength < expectedSize) {
      console.warn(`[SogStreamer] LOD 树数据不完整: 期望 ${expectedSize} 字节, 实际 ${buffer.byteLength}`);
      return;
    }

    const levels: number[] = [];
    for (let i = 0; i < numLevels; i++) {
      levels.push(view.getUint32(LOD_TREE_HEADER_SIZE + i * 4, true));
    }

    meta.lodLevels = levels;
    meta.lodBase = lodBase;
  }

  /** 顺序加载所有 chunk */
  private async loadChunksSequential(): Promise<void> {
    if (!this.metadata) return;

    const maxChunks = Math.min(this._maxChunksToLoad, this.metadata.numChunks);
    for (let c = 0; c < maxChunks; c++) {
      if (this.aborted) return;

      await this.loadChunk(c);

      this.options.onProgress?.(
        this.loadedChunks.size,
        maxChunks,
        this.countLoadedSplats(),
        this.metadata.numSplats,
      );
    }
  }

  /** 并行加载 chunk */
  private async loadChunksParallel(): Promise<void> {
    if (!this.metadata) return;

    const parallelCount = this.options.parallelCount ?? 4;
    const maxChunks = Math.min(this._maxChunksToLoad, this.metadata.numChunks);
    const queue = Array.from({ length: maxChunks }, (_, i) => i);

    const workers: Promise<void>[] = [];
    for (let w = 0; w < parallelCount; w++) {
      workers.push(this.parallelWorker(queue, maxChunks));
    }

    await Promise.all(workers);
  }

  /** 并行加载 worker */
  private async parallelWorker(queue: number[], maxChunks: number): Promise<void> {
    while (queue.length > 0 && !this.aborted) {
      const chunkIndex = queue.shift()!;
      await this.loadChunk(chunkIndex);

      if (this.metadata) {
        this.options.onProgress?.(
          this.loadedChunks.size,
          maxChunks,
          this.countLoadedSplats(),
          this.metadata.numSplats,
        );
      }
    }
  }

  /** 加载单个 chunk (含 gzip 解压) */
  private async loadChunk(index: number): Promise<void> {
    if (!this.metadata || this.loadedChunks.has(index)) return;

    const chunk = this.metadata.chunks[index];
    if (!chunk) return;

    try {
      const rawData = await this.fetchRange(chunk.offset, chunk.offset + chunk.size);

      // ★ P1-2: 若 compression=1, 使用 DecompressionStream 解压
      let decompressedData: ArrayBuffer;
      if (this.metadata.compression === COMPRESSION_GZIP) {
        decompressedData = await this.decompressGzip(rawData);
      } else {
        decompressedData = rawData;
      }

      // ★ P2-3: 若 positionQuantization=1, 反量化位置数据 (29B → 32B .splat)
      if (this.metadata.positionQuantization === POSITION_QUANT_24BIT) {
        decompressedData = this.dequantizePositions(
          decompressedData,
          chunk.count,
          this.metadata.bboxMin,
          this.metadata.bboxMax,
        );
      }

      this.loadedChunks.add(index);
      this.options.onChunkLoaded?.(index, decompressedData, chunk.count);
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /**
   * ★ P1-2: 使用浏览器原生 DecompressionStream 解压 gzip 数据
   *
   * [来源: DecompressionStream — developer.mozilla.org/en-US/docs/Web/API/DecompressionStream]
   */
  private async decompressGzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
    // 检查 DecompressionStream 是否可用 (现代浏览器都支持)
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream 不可用, 无法解压 gzip 压缩的 SOG chunk');
    }

    const ds = new DecompressionStream('gzip');
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    const decompressed = await new Response(stream).arrayBuffer();
    return decompressed;
  }

  /**
   * ★ P2-3: 反量化位置数据 — 将紧凑 29 字节格式转换为 .splat 32 字节格式
   *
   * 紧凑格式 (29 bytes/splat):
   *   Position XYZ  3 × Uint24 LE  (9 bytes)  — 量化值
   *   Scale XYZ     3 × Float32    (12 bytes)
   *   Color RGBA    4 × Uint8      (4 bytes)
   *   Rotation IJKL 4 × Uint8      (4 bytes)
   *
   * .splat 格式 (32 bytes/splat):
   *   Position XYZ  3 × Float32    (12 bytes)  — 反量化后的位置
   *   Scale XYZ     3 × Float32    (12 bytes)
   *   Color RGBA    4 × Uint8      (4 bytes)
   *   Rotation IJKL 4 × Uint8      (4 bytes)
   *
   * 反量化公式: position = quantized / 0xFFFFFF * range + bboxMin
   *
   * [来源: P2-3 位置量化 — docs/plan/07-性能深度分析与优化执行方案.md §10.3]
   * [来源: SPZ 格式 — github.com/nianticlabs/spz, 24-bit 位置反量化]
   */
  private dequantizePositions(
    compactData: ArrayBuffer,
    splatCount: number,
    bboxMin: [number, number, number],
    bboxMax: [number, number, number],
  ): ArrayBuffer {
    const src = new DataView(compactData);
    const output = new ArrayBuffer(splatCount * SPLAT_BYTES_PER_SPLAT);
    const dst = new DataView(output);

    const rangeX = (bboxMax[0] - bboxMin[0]) || 1;
    const rangeY = (bboxMax[1] - bboxMin[1]) || 1;
    const rangeZ = (bboxMax[2] - bboxMin[2]) || 1;

    for (let i = 0; i < splatCount; i++) {
      const srcBase = i * COMPACT_BYTES_PER_SPLAT;
      const dstBase = i * SPLAT_BYTES_PER_SPLAT;

      // 反量化 Position XYZ: Uint24 → Float32
      const qx = src.getUint8(srcBase) | (src.getUint8(srcBase + 1) << 8) | (src.getUint8(srcBase + 2) << 16);
      const qy = src.getUint8(srcBase + 3) | (src.getUint8(srcBase + 4) << 8) | (src.getUint8(srcBase + 5) << 16);
      const qz = src.getUint8(srcBase + 6) | (src.getUint8(srcBase + 7) << 8) | (src.getUint8(srcBase + 8) << 16);

      dst.setFloat32(dstBase + 0, (qx / QUANT_MAX) * rangeX + bboxMin[0], true);
      dst.setFloat32(dstBase + 4, (qy / QUANT_MAX) * rangeY + bboxMin[1], true);
      dst.setFloat32(dstBase + 8, (qz / QUANT_MAX) * rangeZ + bboxMin[2], true);

      // Scale XYZ: Float32 直接复制 (offset 9→12, 13→16, 17→20)
      dst.setFloat32(dstBase + 12, src.getFloat32(srcBase + 9, true), true);
      dst.setFloat32(dstBase + 16, src.getFloat32(srcBase + 13, true), true);
      dst.setFloat32(dstBase + 20, src.getFloat32(srcBase + 17, true), true);

      // Color RGBA: 4 × Uint8 直接复制 (offset 21→24, 22→25, 23→26, 24→27)
      dst.setUint8(dstBase + 24, src.getUint8(srcBase + 21));
      dst.setUint8(dstBase + 25, src.getUint8(srcBase + 22));
      dst.setUint8(dstBase + 26, src.getUint8(srcBase + 23));
      dst.setUint8(dstBase + 27, src.getUint8(srcBase + 24));

      // Rotation IJKL: 4 × Uint8 直接复制 (offset 25→28, 26→29, 27→30, 28→31)
      dst.setUint8(dstBase + 28, src.getUint8(srcBase + 25));
      dst.setUint8(dstBase + 29, src.getUint8(srcBase + 26));
      dst.setUint8(dstBase + 30, src.getUint8(srcBase + 27));
      dst.setUint8(dstBase + 31, src.getUint8(srcBase + 28));
    }

    return output;
  }

  /** 计算已加载的 splat 总数 */
  private countLoadedSplats(): number {
    if (!this.metadata) return 0;
    let count = 0;
    for (const idx of this.loadedChunks) {
      count += this.metadata.chunks[idx]?.count || 0;
    }
    return count;
  }
}
