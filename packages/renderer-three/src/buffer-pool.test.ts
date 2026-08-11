import { describe, it, expect, beforeEach } from 'vitest';
import { SplatBufferPool } from './buffer-pool.js';

// ── SplatBufferPool 测试 ──────────────────────────────────

describe('SplatBufferPool', () => {
  let pool: SplatBufferPool;

  beforeEach(() => {
    pool = new SplatBufferPool();
  });

  // ── 基本 acquire / release ──

  it('★ acquire 返回正确大小的 buffer', () => {
    const buf = pool.acquire(1024);
    expect(buf.byteLength).toBe(1024);
    expect(buf).toBeInstanceOf(ArrayBuffer);
  });

  it('★ release 后再 acquire 相同大小命中池', () => {
    const buf1 = pool.acquire(1024);
    pool.release(buf1);
    const buf2 = pool.acquire(1024);

    // 应该命中池 (复用)
    const stats = pool.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('★ 未 release 时 acquire 未命中', () => {
    const buf1 = pool.acquire(1024);
    const buf2 = pool.acquire(1024);

    // 两次都应该是 miss
    const stats = pool.getStats();
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(0);

    // 两个 buffer 应该不同
    expect(buf1).not.toBe(buf2);
  });

  // ── 匹配策略 ──

  it('★ ceil-with-slice 策略: 返回精确大小的 slice', () => {
    const poolSlice = new SplatBufferPool({
      matchStrategy: 'ceil-with-slice',
    });

    const buf1 = poolSlice.acquire(1000);
    poolSlice.release(buf1);
    // 请求更小的 size, 应该复用并 slice
    const buf2 = poolSlice.acquire(800);

    expect(buf2.byteLength).toBe(800);
    expect(poolSlice.getStats().hits).toBe(1);
  });

  it('★ exact 策略: 只复用大小完全相同的 buffer', () => {
    const poolExact = new SplatBufferPool({
      matchStrategy: 'exact',
    });

    const buf1 = poolExact.acquire(1000);
    poolExact.release(buf1);
    // 请求不同大小, 不应命中
    const buf2 = poolExact.acquire(800);

    expect(buf2.byteLength).toBe(800);
    expect(poolExact.getStats().hits).toBe(0);
    expect(poolExact.getStats().misses).toBe(2);
  });

  it('★ exact 策略: 相同大小命中', () => {
    const poolExact = new SplatBufferPool({
      matchStrategy: 'exact',
    });

    const buf1 = poolExact.acquire(1000);
    poolExact.release(buf1);
    const buf2 = poolExact.acquire(1000);

    expect(poolExact.getStats().hits).toBe(1);
    expect(buf2).toBe(buf1); // 同一个 buffer
  });

  it('★ ceil 策略: 复用更大的 buffer (不 slice)', () => {
    const poolCeil = new SplatBufferPool({
      matchStrategy: 'ceil',
    });

    const buf1 = poolCeil.acquire(1000);
    poolCeil.release(buf1);
    const buf2 = poolCeil.acquire(800);

    // 应该复用 buf1 (1000 >= 800)
    expect(buf2).toBe(buf1);
    expect(buf2.byteLength).toBe(1000); // 大小不变
    expect(poolCeil.getStats().hits).toBe(1);
  });

  it('★ tolerance 限制复用大小差异', () => {
    const poolTol = new SplatBufferPool({
      matchStrategy: 'ceil',
      tolerance: 0.1, // 最多大 10%
    });

    const buf1 = poolTol.acquire(1000);
    poolTol.release(buf1);
    // 请求 800, tolerance=0.1 → maxSize=880 < 1000, 不应命中
    const buf2 = poolTol.acquire(800);

    expect(buf2.byteLength).toBe(800);
    expect(poolTol.getStats().hits).toBe(0);
  });

  // ── 池容量限制 ──

  it('★ maxPoolSize 限制池中 buffer 数', () => {
    const poolSmall = new SplatBufferPool({ maxPoolSize: 2 });

    poolSmall.acquire(100);
    poolSmall.release(new ArrayBuffer(100));
    poolSmall.release(new ArrayBuffer(100));
    poolSmall.release(new ArrayBuffer(100)); // 应被丢弃

    expect(poolSmall.getPooledCount()).toBe(2);
    expect(poolSmall.getStats().evictedCount).toBe(1);
  });

  it('★ maxPoolBytes 限制池总内存', () => {
    const poolMem = new SplatBufferPool({
      maxPoolSize: 10,
      maxPoolBytes: 1024, // 1KB 限制
    });

    poolMem.release(new ArrayBuffer(512));
    poolMem.release(new ArrayBuffer(512));
    // 总和已达 1024, 再释放应被丢弃
    poolMem.release(new ArrayBuffer(256));

    expect(poolMem.getPooledCount()).toBe(2);
    expect(poolMem.getPooledBytes()).toBe(1024);
  });

  // ── LRU 淘汰 ──

  it('★ LRU 淘汰最旧的 buffer', () => {
    const poolLRU = new SplatBufferPool({ maxPoolSize: 2 });

    // 入池顺序: buf1 < buf2
    const buf1 = new ArrayBuffer(100);
    const buf2 = new ArrayBuffer(200);
    poolLRU.release(buf1);
    poolLRU.release(buf2);

    // 释放一个大 buffer, 应淘汰最旧的 buf1
    const buf3 = new ArrayBuffer(300);
    poolLRU.release(buf3);

    // buf1 被淘汰, buf2 和 buf3 在池中
    expect(poolLRU.getPooledCount()).toBe(2);
    expect(poolLRU.getStats().evictedCount).toBe(1);

    // 获取 200 大小的应命中 buf2
    const acquired = poolLRU.acquire(200);
    expect(acquired).toBe(buf2);
  });

  // ── clear ──

  it('★ clear 清空池', () => {
    pool.release(new ArrayBuffer(100));
    pool.release(new ArrayBuffer(200));

    expect(pool.getPooledCount()).toBe(2);

    pool.clear();

    expect(pool.getPooledCount()).toBe(0);
    expect(pool.getPooledBytes()).toBe(0);
  });

  // ── 统计 ──

  it('★ getHitRate 返回正确命中率', () => {
    // miss, miss, release, hit → 1 hit / 3 total
    pool.acquire(100);
    pool.acquire(100);
    pool.release(new ArrayBuffer(100));
    pool.acquire(100);

    const rate = pool.getHitRate();
    expect(rate).toBeCloseTo(1 / 3); // 1 hit / 3 total
  });

  it('★ getHitRate 空池返回 0', () => {
    expect(pool.getHitRate()).toBe(0);
  });

  it('★ totalAllocatedBytes 统计新分配的字节', () => {
    pool.acquire(100);
    pool.acquire(200);

    const stats = pool.getStats();
    expect(stats.totalAllocatedBytes).toBe(300);
  });

  it('★ totalReleasedBytes 统计释放的字节', () => {
    pool.release(new ArrayBuffer(100));
    pool.release(new ArrayBuffer(200));

    const stats = pool.getStats();
    expect(stats.totalReleasedBytes).toBe(300);
  });

  // ── 边界情况 ──

  it('★ acquire 0 大小不崩溃', () => {
    const buf = pool.acquire(0);
    expect(buf.byteLength).toBe(0);
  });

  it('★ release 空 buffer 不崩溃', () => {
    pool.release(new ArrayBuffer(0));
    expect(pool.getPooledCount()).toBe(1);
  });

  it('★ 多次 acquire/release 循环正确', () => {
    // 模拟场景切换: A → B → A → B
    for (let i = 0; i < 4; i++) {
      const size = 1024 * (i % 2 === 0 ? 100 : 200);
      const buf = pool.acquire(size);
      pool.release(buf);
    }

    const stats = pool.getStats();
    // 第一次 A 和 B 是 miss, 后续应该 hit
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(2);
  });

  it('★ 不同大小交替使用', () => {
    const poolMix = new SplatBufferPool({
      matchStrategy: 'ceil-with-slice',
      maxPoolSize: 8, // 足够大以容纳所有 buffer
    });

    // 分配不同大小
    const sizes = [100, 200, 300, 400, 100, 200, 300, 400];
    const buffers: ArrayBuffer[] = [];

    for (const size of sizes) {
      buffers.push(poolMix.acquire(size));
    }

    // 释放所有
    for (const buf of buffers) {
      poolMix.release(buf);
    }

    // 再次分配相同大小, 应全部命中
    for (const size of sizes) {
      poolMix.acquire(size);
    }

    const stats = poolMix.getStats();
    // 前 8 次 miss, 后 8 次 hit
    expect(stats.misses).toBe(8);
    expect(stats.hits).toBe(8);
  });
});
