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
  // 如果 Worker 不可用 (如非跨域隔离), 回退到主线程拼接
  if (typeof Worker === 'undefined') {
    return concatChunksMainThread(chunks);
  }

  return new Promise((resolve) => {
    try {
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
      const worker = new Worker(URL.createObjectURL(blob));

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
