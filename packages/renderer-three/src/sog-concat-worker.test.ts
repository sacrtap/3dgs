import { describe, it, expect } from 'vitest';
import { concatChunksInWorker } from './sog-concat-worker.js';

/**
 * ★ D-02 防御性校验测试:
 * 旧实现中 SOG chunk 加载失败会在数组中留下稀疏空洞 (undefined),
 * 拼接时 `new Uint8Array(undefined)` 抛 TypeError 导致崩溃而非回退。
 */
describe('concatChunksInWorker — D-02 空洞防御', () => {
  it('稀疏数组 (含空洞) 抛出可读错误而非 TypeError 崩溃', async () => {
    const chunks: ArrayBuffer[] = [];
    chunks[0] = new Uint8Array([1, 2, 3]).buffer;
    // chunks[1] 缺失 (加载失败留下的空洞)
    chunks[2] = new Uint8Array([7, 8, 9]).buffer;

    await expect(concatChunksInWorker(chunks)).rejects.toThrow(/chunk\[1\] 缺失/);
  });

  it('空数组正常拼接为空 buffer', async () => {
    const result = await concatChunksInWorker([]);
    expect(result.byteLength).toBe(0);
  });

  it('完整 chunk 列表正确拼接 (主线程回退路径)', async () => {
    // Node 测试环境无浏览器 Worker 全局, 走主线程拼接回退 — 行为一致
    const chunks = [
      new Uint8Array([1, 2]).buffer,
      new Uint8Array([3, 4, 5]).buffer,
    ];

    const result = await concatChunksInWorker(chunks);

    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('undefined 元素在任意位置都被检出', async () => {
    const chunks = [undefined as unknown as ArrayBuffer];

    await expect(concatChunksInWorker(chunks)).rejects.toThrow(/chunk\[0\] 缺失/);
  });
});
