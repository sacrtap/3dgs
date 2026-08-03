/**
 * SOG 流式 LOD 客户端 — 分块加载管理器
 *
 * 从 SOG 文件流式加载高斯核数据, 支持渐进式渲染。
 *
 * 工作流程:
 *   1. 获取 SOG 文件 header (前 64 字节) → 获取 numChunks, chunkSize
 *   2. 获取 chunk index (numChunks × 8 字节)
 *   3. 按顺序加载各 chunk (使用 HTTP Range 请求)
 *   4. 前面的 chunk 先加载渲染, 后面的 chunk 逐步补充细节
 *
 * [来源: 项目源码 — packages/convert/src/sog-writer.ts]
 * [来源: PlayCanvas SOG 流式 — blog.playcanvas.com]
 */

/** SOG chunk 索引条目 (本地定义, 避免 cross-package 依赖) */
export interface SogChunkEntry {
  /** chunk 在文件中的字节偏移 */
  offset: number;
  /** chunk 数据的字节大小 */
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
}

/** SOG 流式加载选项 */
export interface SogStreamerOptions {
  /** SOG 文件 URL */
  url: string;
  /** 加载进度回调 */
  onProgress?: (loadedChunks: number, totalChunks: number, loadedSplats: number, totalSplats: number) => void;
  /** chunk 加载完成回调 (返回该 chunk 的 splat 数据) */
  onChunkLoaded?: (chunkIndex: number, data: ArrayBuffer, count: number) => void;
  /** 所有 chunk 加载完成回调 */
  onComplete?: () => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 是否并行加载多个 chunk (默认 false, 顺序加载) */
  parallel?: boolean;
  /** 并行加载数量 (默认 2) */
  parallelCount?: number;
}
export class SogStreamer {
  private options: SogStreamerOptions;
  private metadata: SogMetadata | null = null;
  private loadedChunks: Set<number> = new Set();
  private aborted = false;

  constructor(options: SogStreamerOptions) {
    this.options = options;
  }

  /**
   * 开始流式加载
   *
   * 1. 获取 header + chunk index
   * 2. 逐个加载 chunk
   */
  async start(): Promise<SogMetadata> {
    // 1. 获取 header (64 bytes)
    const headerBuffer = await this.fetchRange(0, 64);
    this.metadata = this.parseHeader(headerBuffer);

    // 2. 获取 chunk index
    const indexSize = this.metadata.numChunks * 8;
    const indexBuffer = await this.fetchRange(64, 64 + indexSize);
    this.parseChunkIndex(indexBuffer, this.metadata);

    // 3. 逐个加载 chunk
    if (this.options.parallel) {
      await this.loadChunksParallel();
    } else {
      await this.loadChunksSequential();
    }

    this.options.onComplete?.();
    return this.metadata;
  }

  /** 中止加载 */
  abort(): void {
    this.aborted = true;
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

  /** 使用 HTTP Range 请求获取部分数据 */
  private async fetchRange(start: number, end: number): Promise<ArrayBuffer> {
    const response = await fetch(this.options.url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: 无法获取 SOG 数据 (Range 请求)`);
    }

    return response.arrayBuffer();
  }

  /** 解析 SOG header */
  private parseHeader(buffer: ArrayBuffer): SogMetadata {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);

    const SOG_MAGIC = 0x31474F53; // "SOG1"
    if (magic !== SOG_MAGIC) {
      throw new Error(`无效的 SOG 文件: magic 不匹配 (0x${magic.toString(16)})`);
    }

    const version = view.getUint16(4, true);
    if (version !== 1) {
      throw new Error(`不支持的 SOG 版本: ${version}`);
    }

    const shDegree = view.getUint8(6);
    const numSplats = view.getUint32(8, true);
    const numChunks = view.getUint32(12, true);
    const chunkSize = view.getUint32(16, true);

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

  /** 顺序加载所有 chunk */
  private async loadChunksSequential(): Promise<void> {
    if (!this.metadata) return;

    for (let c = 0; c < this.metadata.numChunks; c++) {
      if (this.aborted) return;

      await this.loadChunk(c);

      this.options.onProgress?.(
        this.loadedChunks.size,
        this.metadata.numChunks,
        this.countLoadedSplats(),
        this.metadata.numSplats,
      );
    }
  }

  /** 并行加载 chunk */
  private async loadChunksParallel(): Promise<void> {
    if (!this.metadata) return;

    const parallelCount = this.options.parallelCount || 2;
    const queue = Array.from({ length: this.metadata.numChunks }, (_, i) => i);

    const workers: Promise<void>[] = [];
    for (let w = 0; w < parallelCount; w++) {
      workers.push(this.parallelWorker(queue));
    }

    await Promise.all(workers);
  }

  /** 并行加载 worker */
  private async parallelWorker(queue: number[]): Promise<void> {
    while (queue.length > 0 && !this.aborted) {
      const chunkIndex = queue.shift()!;
      await this.loadChunk(chunkIndex);

      if (this.metadata) {
        this.options.onProgress?.(
          this.loadedChunks.size,
          this.metadata.numChunks,
          this.countLoadedSplats(),
          this.metadata.numSplats,
        );
      }
    }
  }

  /** 加载单个 chunk */
  private async loadChunk(index: number): Promise<void> {
    if (!this.metadata || this.loadedChunks.has(index)) return;

    const chunk = this.metadata.chunks[index];
    if (!chunk) return;

    try {
      const data = await this.fetchRange(chunk.offset, chunk.offset + chunk.size);
      this.loadedChunks.add(index);
      this.options.onChunkLoaded?.(index, data, chunk.count);
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
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
