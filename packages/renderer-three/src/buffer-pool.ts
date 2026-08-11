/**
 * SplatBufferPool — GPU Buffer 池化复用
 *
 * ★ P2-2 优化: 深度优化
 *
 * 问题: 场景切换时 GPU Buffer 被释放再重新分配, 浪费时间。
 *
 * 方案: 实现 Buffer 池, 场景切换时复用 Buffer。
 *   1. release() 时将 buffer 放回池中而非释放
 *   2. acquire() 时从池中查找大小足够的 buffer 复用
 *   3. 池有最大容量限制, 超出时真正释放
 *   4. 提供 hit/miss 统计用于性能监控
 *
 * 预期效果: 场景切换时间减少 30-50%。
 *
 * [来源: 性能优化方案 — docs/plan/07-性能深度分析与优化执行方案.md §10.2]
 * [来源: 对象池模式 — en.wikipedia.org/wiki/Object_pool_pattern]
 */

/** 池中缓存条目 */
interface PoolEntry {
  /** 底层 ArrayBuffer */
  buffer: ArrayBuffer;
  /** buffer 大小 (字节) */
  size: number;
  /** 入池时间戳 (用于 LRU 淘汰) */
  releasedAt: number;
}

/** Buffer 池统计信息 */
export interface BufferPoolStats {
  /** acquire 命中次数 (从池中复用) */
  hits: number;
  /** acquire 未命中次数 (新分配) */
  misses: number;
  /** 当前池中缓存的 buffer 数 */
  pooledCount: number;
  /** 当前池中缓存的总字节数 */
  pooledBytes: number;
  /** 历史累计分配的总字节数 */
  totalAllocatedBytes: number;
  /** 历史累计释放回池的总字节数 */
  totalReleasedBytes: number;
  /** 历史累计因池满而丢弃的 buffer 数 */
  evictedCount: number;
}

/** Buffer 池选项 */
export interface BufferPoolOptions {
  /** 池最大容量 (buffer 数量, 默认 16) */
  maxPoolSize?: number;
  /** 池最大内存 (字节, 默认 256MB) */
  maxPoolBytes?: number;
  /**
   * 大小匹配策略:
   *   - 'exact': 只复用大小完全相同的 buffer
   *   - 'ceil': 复用大小 >= 请求大小的最小 buffer (默认)
   *   - 'ceil-with-slice': 同 'ceil' 但返回精确大小的 slice
   */
  matchStrategy?: 'exact' | 'ceil' | 'ceil-with-slice';
  /**
   * 大小容忍度 (仅 'ceil' 和 'ceil-with-slice' 策略)
   * 复用的 buffer 大小不超过 请求大小 × (1 + tolerance)
   * 默认 0.5 (即最多大 50%)
   */
  tolerance?: number;
}

/**
 * SplatBufferPool — ArrayBuffer 对象池
 *
 * 用于场景切换时复用已分配的 ArrayBuffer, 避免重复 GC 和分配开销。
 *
 * 使用方式:
 *   const pool = new SplatBufferPool({ maxPoolSize: 8 });
 *
 *   // 场景 A 加载
 *   const bufA = pool.acquire(1024 * 1024);
 *   // ... 使用 bufA ...
 *
 *   // 切换到场景 B: 释放 A 的 buffer 到池中
 *   pool.release(bufA);
 *
 *   // 场景 B 加载: 从池中复用
 *   const bufB = pool.acquire(1024 * 1024); // 命中池, 无需新分配
 */
export class SplatBufferPool {
  private pool: PoolEntry[] = [];
  private options: Required<BufferPoolOptions>;
  private stats: BufferPoolStats;

  constructor(options: BufferPoolOptions = {}) {
    this.options = {
      maxPoolSize: options.maxPoolSize ?? 16,
      maxPoolBytes: options.maxPoolBytes ?? 256 * 1024 * 1024,
      matchStrategy: options.matchStrategy ?? 'ceil-with-slice',
      tolerance: options.tolerance ?? 0.5,
    };
    this.stats = {
      hits: 0,
      misses: 0,
      pooledCount: 0,
      pooledBytes: 0,
      totalAllocatedBytes: 0,
      totalReleasedBytes: 0,
      evictedCount: 0,
    };
  }

  /**
   * 从池中获取一个 buffer
   *
   * 若池中有大小匹配的 buffer, 复用之 (hit);
   * 否则分配新的 ArrayBuffer (miss)。
   *
   * @param size 需要的 buffer 大小 (字节)
   * @returns 大小 >= size 的 ArrayBuffer
   */
  acquire(size: number): ArrayBuffer {
    // 尝试从池中查找匹配的 buffer
    const entry = this.findBestMatch(size);

    if (entry) {
      // 命中: 从池中移除并返回
      this.removeFromPool(entry);
      this.stats.hits++;

      // ceil-with-slice 策略: 返回精确大小的 slice
      if (this.options.matchStrategy === 'ceil-with-slice' && entry.size > size) {
        return entry.buffer.slice(0, size);
      }

      return entry.buffer;
    }

    // 未命中: 新分配
    this.stats.misses++;
    this.stats.totalAllocatedBytes += size;
    return new ArrayBuffer(size);
  }

  /**
   * 将不再使用的 buffer 释放回池中
   *
   * 若池已满或超过内存限制, buffer 将被丢弃 (由 GC 回收)。
   *
   * @param buffer 要释放的 ArrayBuffer
   */
  release(buffer: ArrayBuffer): void {
    const size = buffer.byteLength;
    this.stats.totalReleasedBytes += size;

    // 检查池容量
    if (this.pool.length >= this.options.maxPoolSize) {
      // 池已满, 尝试 LRU 淘汰最小的旧条目
      this.evictIfNeeded(size);
    }

    // 检查内存限制
    if (this.stats.pooledBytes + size > this.options.maxPoolBytes) {
      // 超出内存限制, 丢弃
      this.stats.evictedCount++;
      return;
    }

    // 仍然超出池容量, 丢弃
    if (this.pool.length >= this.options.maxPoolSize) {
      this.stats.evictedCount++;
      return;
    }

    // 入池
    this.pool.push({
      buffer,
      size,
      releasedAt: performance.now(),
    });
    this.stats.pooledCount++;
    this.stats.pooledBytes += size;
  }

  /**
   * 清空池中所有 buffer
   */
  clear(): void {
    const count = this.pool.length;
    this.pool = [];
    this.stats.pooledCount = 0;
    this.stats.pooledBytes = 0;
    this.stats.evictedCount += count;
  }

  /**
   * 获取统计信息
   */
  getStats(): BufferPoolStats {
    return { ...this.stats };
  }

  /**
   * 获取命中率 (0-1)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return this.stats.hits / total;
  }

  /**
   * 获取当前池中 buffer 数
   */
  getPooledCount(): number {
    return this.pool.length;
  }

  /**
   * 获取当前池中总字节数
   */
  getPooledBytes(): number {
    return this.stats.pooledBytes;
  }

  // ── 内部方法 ──

  /** 从池中查找大小最匹配的 buffer */
  private findBestMatch(size: number): PoolEntry | null {
    if (this.pool.length === 0) return null;

    const strategy = this.options.matchStrategy;
    const tolerance = this.options.tolerance;
    const maxSize = size * (1 + tolerance);

    let bestEntry: PoolEntry | null = null;
    let bestSize = Infinity;

    for (const entry of this.pool) {
      if (strategy === 'exact') {
        // 精确匹配
        if (entry.size === size) {
          return entry;
        }
      } else {
        // ceil 或 ceil-with-slice: 找 >= size 且 <= maxSize 的最小 buffer
        if (entry.size >= size && entry.size <= maxSize && entry.size < bestSize) {
          bestEntry = entry;
          bestSize = entry.size;
        }
      }
    }

    return bestEntry;
  }

  /** 从池中移除条目 */
  private removeFromPool(entry: PoolEntry): void {
    const idx = this.pool.indexOf(entry);
    if (idx >= 0) {
      this.pool.splice(idx, 1);
      this.stats.pooledCount--;
      this.stats.pooledBytes -= entry.size;
    }
  }

  /**
   * LRU 淘汰: 移除最旧且最小的条目
   *
   * 仅当新 buffer 比要淘汰的 buffer 大时才淘汰
   */
  private evictIfNeeded(newSize: number): void {
    if (this.pool.length === 0) return;

    // 找到最旧的条目
    let oldestIdx = 0;
    let oldestTime = this.pool[0].releasedAt;
    for (let i = 1; i < this.pool.length; i++) {
      if (this.pool[i].releasedAt < oldestTime) {
        oldestTime = this.pool[i].releasedAt;
        oldestIdx = i;
      }
    }

    const oldest = this.pool[oldestIdx];
    // 只在新 buffer 比旧的大时才淘汰 (优先保留小 buffer, 它们更通用)
    if (newSize > oldest.size) {
      this.pool.splice(oldestIdx, 1);
      this.stats.pooledCount--;
      this.stats.pooledBytes -= oldest.size;
      this.stats.evictedCount++;
    }
  }
}
