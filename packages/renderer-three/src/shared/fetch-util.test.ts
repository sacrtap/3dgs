/**
 * ★ TD-08: fetchWithProgress 单元测试
 *   - reader 分块 → 完整合并 + 逐块进度回调
 *   - 无 Content-Length → total 为 0 且不回调
 *   - 无 body stream → 一次性读取
 *   - 非 2xx → 抛错
 *   - AbortSignal 透传
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithProgress } from './fetch-util.js';

/** 构造流式 Response — chunks 按序作为 body 块返回; contentLength 为 undefined 时不带该头 */
function streamResponse(chunks: Uint8Array[], status = 200, contentLength?: number): Response {
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) {
    headers['Content-Length'] = String(contentLength);
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithProgress', () => {
  it('分块合并并逐块回调进度', async () => {
    const c1 = new Uint8Array([1, 2, 3]);
    const c2 = new Uint8Array([4, 5]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([c1, c2], 200, 5)));

    const onProgress = vi.fn();
    const data = await fetchWithProgress('https://example.com/a.splat', { onProgress });

    expect(data).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 3, 5);
    expect(onProgress).toHaveBeenNthCalledWith(2, 5, 5);
  });

  it('无 Content-Length 时不回调进度 (total 未知)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(streamResponse([new Uint8Array([7])], 200, undefined)),
    );

    const onProgress = vi.fn();
    const data = await fetchWithProgress('https://example.com/a.splat', { onProgress });

    expect(data).toEqual(new Uint8Array([7]));
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('无 body stream 时一次性读取且不回调', async () => {
    const body = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        arrayBuffer: async () => body.buffer as ArrayBuffer,
      }),
    );

    const onProgress = vi.fn();
    const data = await fetchWithProgress('https://example.com/a.splat', { onProgress });

    expect(data).toEqual(body);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(fetchWithProgress('https://example.com/missing.splat')).rejects.toThrow(
      'fetch https://example.com/missing.splat: 404',
    );
  });

  it('AbortSignal 透传给 fetch', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([new Uint8Array([1])]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithProgress('https://example.com/a.splat', { signal });
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/a.splat', { signal });
  });
});
