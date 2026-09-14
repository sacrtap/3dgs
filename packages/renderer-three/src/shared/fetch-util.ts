/**
 * 共享网络工具 — fetch + 流式进度
 *
 * ★ TD-08: 双后端 (WebGL/WebGPU) 下载逻辑统一。
 *   原实现分散在 RenderManager / WebGPURenderManager 的 4 处加载路径中,
 *   进度语义与错误消息各不相同。本模块提供唯一实现:
 *   - reader 分块读取, 每块回调 onProgress(received, total)
 *   - Content-Length 缺失时 total 传 0 (对齐 ProgressEvent.lengthComputable 语义)
 *   - 无 body stream 时一次性读取 (仍不回调进度, 与旧行为一致)
 */

export interface FetchWithProgressOptions {
  /** 下载进度回调 (字节单位; total 为 0 表示长度未知) */
  onProgress?: (received: number, total: number) => void;
  /** 中止信号 (透传 fetch + reader) */
  signal?: AbortSignal;
}

/**
 * 带流式进度的 fetch — 返回完整响应体 Uint8Array
 *
 * @param url 资源地址
 * @param options 进度回调 + 中止信号
 * @throws 响应非 2xx 时抛错 (消息统一为 `fetch ${url}: ${status}`)
 */
export async function fetchWithProgress(
  url: string,
  options: FetchWithProgressOptions = {},
): Promise<Uint8Array> {
  const { onProgress, signal } = options;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`fetch ${url}: ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
  const reader = response.body?.getReader();

  if (!reader) {
    // 无 body stream: 一次性读取, 不回调进度 (与旧行为一致)
    return new Uint8Array(await response.arrayBuffer());
  }

  // 分块读取, 报告下载进度
  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      receivedLength += value.byteLength;
      if (onProgress && contentLength > 0) {
        onProgress(receivedLength, contentLength);
      }
    }
  }

  // 合并 chunks
  const data = new Uint8Array(receivedLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}
