/**
 * ★ TD-08: downsampleSplatBytes / loadSogChunks 单元测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downsampleSplatBytes, loadSogChunks } from './scene-loader.js';
import { SogStreamer } from '../sog-streamer.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 构造 N 个 splat 的 .splat 字节 (第 i 个 splat 首字节为 i, 便于断言) */
function makeSplatBytes(n: number): Uint8Array {
  const data = new Uint8Array(n * 32);
  for (let i = 0; i < n; i++) {
    data[i * 32] = i;
  }
  return data;
}

describe('downsampleSplatBytes', () => {
  it('未超限时原样返回, 不拷贝', () => {
    const data = makeSplatBytes(10);
    const result = downsampleSplatBytes(data, 20);
    expect(result.data).toBe(data);
    expect(result.sampled).toBe(10);
    expect(result.total).toBe(10);
  });

  it('超限时均匀降采样, 空间覆盖保持', () => {
    const data = makeSplatBytes(100);
    const result = downsampleSplatBytes(data, 25);
    expect(result.sampled).toBe(25);
    expect(result.total).toBe(100);
    // 采样为每隔 4 取 1: 首字节应依次为 0, 4, 8, ...
    expect(result.data[0]).toBe(0);
    expect(result.data[32]).toBe(4);
    expect(result.data[32 * 24]).toBe(96);
  });

  it('注入 pool 时使用 pool.acquire + track', () => {
    const data = makeSplatBytes(100);
    const acquired: ArrayBuffer[] = [];
    const tracked: ArrayBuffer[] = [];
    const pool = {
      acquire: (bytes: number) => {
        const buf = new ArrayBuffer(bytes);
        acquired.push(buf);
        return buf;
      },
      track: (buf: ArrayBuffer) => tracked.push(buf),
    };

    const result = downsampleSplatBytes(data, 25, pool);
    expect(acquired).toHaveLength(1);
    expect(acquired[0].byteLength).toBe(25 * 32);
    expect(tracked).toEqual(acquired);
    expect(result.data.buffer).toBe(acquired[0]);
  });

  it('降采样结果数据正确 (逐字节验证)', () => {
    const data = makeSplatBytes(50);
    const result = downsampleSplatBytes(data, 10);
    for (let i = 0; i < 10; i++) {
      expect(result.data[i * 32]).toBe(i * 5);
    }
  });
});

describe('loadSogChunks', () => {
  it('返回 metadata + streamer, 空 chunk 时 fullData 为空 buffer', async () => {
    vi.spyOn(SogStreamer.prototype, 'start').mockResolvedValue({
      numSplats: 5,
      numChunks: 2,
      version: 2,
      compression: 0,
      positionQuantization: 0,
      lodLevels: [],
      lodBase: 0,
    } as never);

    const onProgress = vi.fn();
    const onError = vi.fn();

    const { fullData, metadata, streamer } = await loadSogChunks('https://example.com/a.sog', 10, {
      onProgress,
      onError,
    });

    expect(metadata.numSplats).toBe(5);
    expect(streamer).toBeInstanceOf(SogStreamer);
    expect(onProgress).not.toHaveBeenCalled(); // start mock 未触发进度回调
    expect(onError).not.toHaveBeenCalled();
    expect(fullData.byteLength).toBe(0); // 无 chunk → 拼接结果为空
  });

  it('start() 抛错时向上传播', async () => {
    vi.spyOn(SogStreamer.prototype, 'start').mockRejectedValue(new Error('chunk 404'));

    await expect(loadSogChunks('https://example.com/a.sog', 10)).rejects.toThrow('chunk 404');
  });
});
