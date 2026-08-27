/**
 * SOG Buffer 拼接 Web Worker
 *
 * P1 优化: 将 SOG 全量 buffer 拼接移到 Worker 线程, 避免阻塞主线程
 *
 * 接收: 各 chunk 的 ArrayBuffer 列表 (通过 Transferable 传输)
 * 返回: 拼接后的完整 ArrayBuffer (通过 Transferable 传输)
 */

export interface SogConcatRequest {
  chunks: ArrayBuffer[];
}

export interface SogConcatResponse {
  buffer: ArrayBuffer;
}

/**
 * 主线程端: 在 Worker 中拼接 SOG chunks
 *
 * 使用方式:
 *   const fullBuffer = await concatChunksInWorker(chunkDataList);
 *   // fullBuffer 已 transfer 回主线程
 */
export async function concatChunksInWorker(chunks: ArrayBuffer[]): Promise<ArrayBuffer> {
  // ★ D-02 防御: 入口校验数组无稀疏空洞 (undefined),
  //   旧实现中空洞会在 Worker 内 `new Uint8Array(undefined)` 抛 TypeError 崩溃;
  //   此处提前报出可读错误, 交由调用方回退链处理。
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) {
      throw new Error(`SOG chunk 拼接失败: chunk[${i}] 缺失 (稀疏空洞), 请检查加载完整性`);
    }
  }

  // 如果 Worker 不可用 (如非跨域隔离), 回退到主线程拼接
  if (typeof Worker === 'undefined') {
    return concatChunksMainThread(chunks);
  }

  return new Promise((resolve) => {
    try {
      // ★ §2.6: 模块级缓存 Worker Blob URL, 避免每次加载新建 Blob 且不释放 (泄漏)
      const workerUrl = getConcatWorkerUrl();
      const worker = new Worker(workerUrl);

      worker.onmessage = (e: MessageEvent) => {
        worker.terminate();
        resolve(e.data.buffer);
      };

      worker.onerror = (_err) => {
        worker.terminate();
        // 回退到主线程
        resolve(concatChunksMainThread(chunks));
      };

      // Transfer 所有 chunk buffer 到 Worker
      const transferList = chunks.map(c => c);
      worker.postMessage({ chunks: transferList }, transferList);
    } catch {
      // Worker 创建失败, 回退到主线程
      resolve(concatChunksMainThread(chunks));
    }
  });
}

/** ★ §2.6: 缓存 concat Worker 的 Blob URL — 进程内只创建一次, 避免反复 new Blob + createObjectURL 泄漏 */
let _concatWorkerUrl: string | null = null;

function getConcatWorkerUrl(): string {
  if (!_concatWorkerUrl) {
    const workerCode = `
      self.onmessage = function(e) {
        const chunks = e.data.chunks;
        const totalBytes = chunks.reduce(function(sum, buf) { return sum + buf.byteLength; }, 0);
        var fullBuffer = new Uint8Array(totalBytes);
        var offset = 0;
        for (var i = 0; i < chunks.length; i++) {
          fullBuffer.set(new Uint8Array(chunks[i]), offset);
          offset += chunks[i].byteLength;
        }
        self.postMessage({ buffer: fullBuffer.buffer }, [fullBuffer.buffer]);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    _concatWorkerUrl = URL.createObjectURL(blob);
  }
  return _concatWorkerUrl;
}

/** 主线程拼接 (回退方案) */
function concatChunksMainThread(chunks: ArrayBuffer[]): ArrayBuffer {
  const totalBytes = chunks.reduce((sum, buf) => sum + buf.byteLength, 0);
  const fullBuffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    fullBuffer.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return fullBuffer.buffer;
}
