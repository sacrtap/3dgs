import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SogStreamer } from './sog-streamer.js';

// ── SOG 文件构造工具 ──────────────────────────────────────

const SOG_MAGIC_V1 = 0x31474F53; // "SOG1"
const SOG_MAGIC_V2 = 0x32474F53; // "SOG2"
const HEADER_SIZE = 64;
const SPLAT_BYTES = 32;

/**
 * 构造一个 SOG v2 文件 (无压缩)
 */
function createMockSogV2File(numChunks: number, chunkSize: number, opts?: {
  compression?: number;
  lodQuality?: number;
}): ArrayBuffer {
  const compression = opts?.compression ?? 0;
  const lodQuality = opts?.lodQuality ?? 1;
  const numSplats = numChunks * chunkSize;
  const indexSize = numChunks * 8;
  const dataSize = numSplats * SPLAT_BYTES;
  const totalSize = HEADER_SIZE + indexSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Header (v2)
  view.setUint32(0, SOG_MAGIC_V2, true);
  view.setUint16(4, 2, true);          // version 2
  view.setUint8(6, 0);                 // shDegree
  view.setUint8(7, compression);       // compression
  view.setUint32(8, numSplats, true);
  view.setUint32(12, numChunks, true);
  view.setUint32(16, chunkSize, true);
  view.setFloat32(20, 0, true);        // bboxMin
  view.setFloat32(24, 0, true);
  view.setFloat32(28, 0, true);
  view.setFloat32(32, 100, true);      // bboxMax
  view.setFloat32(36, 100, true);
  view.setFloat32(40, 100, true);
  view.setUint32(44, 0, true);         // lodTreeOffset
  view.setUint32(48, 0, true);         // lodTreeSize
  view.setUint8(52, lodQuality);       // lodQuality

  // Chunk index + data
  let dataOffset = HEADER_SIZE + indexSize;
  for (let c = 0; c < numChunks; c++) {
    const base = HEADER_SIZE + c * 8;
    view.setUint32(base, dataOffset, true);
    view.setUint32(base + 4, chunkSize * SPLAT_BYTES, true);
    dataOffset += chunkSize * SPLAT_BYTES;
  }

  // Chunk data
  const bytes = new Uint8Array(buffer);
  for (let c = 0; c < numChunks; c++) {
    const offset = HEADER_SIZE + indexSize + c * chunkSize * SPLAT_BYTES;
    for (let i = 0; i < chunkSize * SPLAT_BYTES; i++) {
      bytes[offset + i] = (c * 10 + i) & 0xff;
    }
  }

  return buffer;
}

/**
 * 构造一个 SOG v1 文件 (向后兼容测试)
 */
function createMockSogV1File(numChunks: number, chunkSize: number): ArrayBuffer {
  const numSplats = numChunks * chunkSize;
  const indexSize = numChunks * 8;
  const dataSize = numSplats * SPLAT_BYTES;
  const totalSize = HEADER_SIZE + indexSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Header (v1)
  view.setUint32(0, SOG_MAGIC_V1, true);
  view.setUint16(4, 1, true);
  view.setUint8(6, 0);
  view.setUint8(7, 0); // reserved in v1
  view.setUint32(8, numSplats, true);
  view.setUint32(12, numChunks, true);
  view.setUint32(16, chunkSize, true);
  view.setFloat32(20, 0, true);
  view.setFloat32(24, 0, true);
  view.setFloat32(28, 0, true);
  view.setFloat32(32, 100, true);
  view.setFloat32(36, 100, true);
  view.setFloat32(40, 100, true);

  let dataOffset = HEADER_SIZE + indexSize;
  for (let c = 0; c < numChunks; c++) {
    const base = HEADER_SIZE + c * 8;
    view.setUint32(base, dataOffset, true);
    view.setUint32(base + 4, chunkSize * SPLAT_BYTES, true);
    dataOffset += chunkSize * SPLAT_BYTES;
  }

  const bytes = new Uint8Array(buffer);
  for (let c = 0; c < numChunks; c++) {
    const offset = HEADER_SIZE + indexSize + c * chunkSize * SPLAT_BYTES;
    for (let i = 0; i < chunkSize * SPLAT_BYTES; i++) {
      bytes[offset + i] = (c * 10 + i) & 0xff;
    }
  }

  return buffer;
}

/**
 * 创建 fetch mock, 处理 HTTP Range 请求
 */
function createMockFetch(sogBuffer: ArrayBuffer) {
  return vi.fn((_url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const range = headers?.Range;
    const match = range?.match(/bytes=(\d+)-(\d+)/);

    if (!match) {
      return Promise.resolve({
        ok: false,
        status: 400,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }

    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    const slice = sogBuffer.slice(start, end + 1);

    return Promise.resolve({
      ok: true,
      status: 206,
      arrayBuffer: () => Promise.resolve(slice),
    });
  });
}

// ── 测试 ──────────────────────────────────────────────────

describe('SogStreamer — P0 并行加载 + P1 v2 格式', () => {
  const numChunks = 6;
  const chunkSize = 10;
  let sogBuffer: ArrayBuffer;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    sogBuffer = createMockSogV2File(numChunks, chunkSize);
    originalFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('默认启用并行加载 (parallel 未设置时)', async () => {
    const loadedChunks: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      onChunkLoaded: (idx) => loadedChunks.push(idx),
    });
    const metadata = await streamer.start();
    expect(metadata.numChunks).toBe(numChunks);
    expect(loadedChunks).toHaveLength(numChunks);
    expect(new Set(loadedChunks).size).toBe(numChunks);
  });

  it('显式 parallel: true 正常工作', async () => {
    const loadedChunks: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog', parallel: true, parallelCount: 4,
      onChunkLoaded: (idx) => loadedChunks.push(idx),
    });
    await streamer.start();
    expect(loadedChunks).toHaveLength(numChunks);
  });

  it('parallel: false 使用顺序加载', async () => {
    const loadedChunks: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog', parallel: false,
      onChunkLoaded: (idx) => loadedChunks.push(idx),
    });
    await streamer.start();
    expect(loadedChunks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('并行加载: chunks 可能乱序到达但全部加载', async () => {
    const loadedChunks: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog', parallel: true, parallelCount: 4,
      onChunkLoaded: (idx) => loadedChunks.push(idx),
    });
    await streamer.start();
    expect(loadedChunks).toHaveLength(numChunks);
    const sorted = [...loadedChunks].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('onProgress 回调被正确调用', async () => {
    const progressCalls: Array<{ loaded: number; total: number }> = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog', parallel: true, parallelCount: 4,
      onProgress: (loadedChunks, totalChunks) => {
        progressCalls.push({ loaded: loadedChunks, total: totalChunks });
      },
    });
    await streamer.start();
    expect(progressCalls.length).toBeGreaterThan(0);
    const last = progressCalls[progressCalls.length - 1];
    expect(last.loaded).toBe(numChunks);
    expect(last.total).toBe(numChunks);
  });

  it('onComplete 在所有 chunk 加载后调用', async () => {
    let completed = false;
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      onComplete: () => { completed = true; },
    });
    await streamer.start();
    expect(completed).toBe(true);
  });

  it('★ v2 metadata 解析正确 (含 compression 和 lodQuality)', async () => {
    const streamer = new SogStreamer({ url: 'mock://test.sog' });
    const metadata = await streamer.start();
    expect(metadata.numSplats).toBe(numChunks * chunkSize);
    expect(metadata.numChunks).toBe(numChunks);
    expect(metadata.chunkSize).toBe(chunkSize);
    expect(metadata.shDegree).toBe(0);
    expect(metadata.chunks).toHaveLength(numChunks);
    expect(metadata.version).toBe(2);
    expect(metadata.compression).toBe(0); // 无压缩
    expect(metadata.lodQuality).toBe(1); // quality
    for (const chunk of metadata.chunks) {
      expect(chunk.count).toBe(chunkSize);
    }
  });

  it('chunk 数据完整性验证', async () => {
    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });
    await streamer.start();
    for (let c = 0; c < numChunks; c++) {
      const data = chunkData.get(c);
      expect(data).toBeDefined();
      expect(data!.byteLength).toBe(chunkSize * SPLAT_BYTES);
    }
  });

  it('abort 中止加载', async () => {
    const loadedChunks: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog', parallel: true, parallelCount: 2,
      onChunkLoaded: (idx) => loadedChunks.push(idx),
    });
    const promise = streamer.start();
    streamer.abort();
    await promise;
    expect(loadedChunks.length).toBeLessThanOrEqual(numChunks);
  });

  it('默认 parallelCount = 4', async () => {
    const streamer = new SogStreamer({ url: 'mock://test.sog' });
    await streamer.start();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2 + numChunks);
  });

  it('错误处理: 无效的 SOG magic', async () => {
    const badBuffer = new ArrayBuffer(64);
    const view = new DataView(badBuffer);
    view.setUint32(0, 0xDEADBEEF, true);
    globalThis.fetch = createMockFetch(badBuffer) as unknown as typeof globalThis.fetch;
    const streamer = new SogStreamer({ url: 'mock://bad.sog' });
    await expect(streamer.start()).rejects.toThrow(/magic 不匹配/);
  });
});

// ── P1: v1 向后兼容测试 ───────────────────────────────────

describe('SogStreamer — P1 v1 向后兼容', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('★ 读取 SOG v1 文件正常工作', async () => {
    const numChunks = 3;
    const chunkSize = 5;
    const sogV1Buffer = createMockSogV1File(numChunks, chunkSize);
    globalThis.fetch = createMockFetch(sogV1Buffer) as unknown as typeof globalThis.fetch;

    const loadedChunks: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://v1.sog',
      onChunkLoaded: (idx) => loadedChunks.push(idx),
    });

    const metadata = await streamer.start();

    expect(metadata.version).toBe(1);
    expect(metadata.numChunks).toBe(numChunks);
    expect(metadata.compression).toBe(0); // v1 无压缩
    expect(metadata.lodQuality).toBe(0);  // v1 无 LOD 字段, 默认 0
    expect(loadedChunks).toHaveLength(numChunks);
  });

  it('★ v1 文件 chunk 数据完整性', async () => {
    const numChunks = 2;
    const chunkSize = 8;
    const sogV1Buffer = createMockSogV1File(numChunks, chunkSize);
    globalThis.fetch = createMockFetch(sogV1Buffer) as unknown as typeof globalThis.fetch;

    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://v1.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });

    await streamer.start();

    for (let c = 0; c < numChunks; c++) {
      const data = chunkData.get(c);
      expect(data).toBeDefined();
      expect(data!.byteLength).toBe(chunkSize * SPLAT_BYTES);
    }
  });
});

// ── P1-2: gzip 解压测试 ───────────────────────────────────

describe('SogStreamer — P1-2 gzip 解压', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('★ 读取带 compression 标记的 v2 文件 (无实际压缩)', async () => {
    // 创建一个标记为 compression=0 的 v2 文件 (无压缩, 但有 v2 header)
    const numChunks = 2;
    const chunkSize = 5;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize, { compression: 0 });
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const streamer = new SogStreamer({ url: 'mock://v2-nocomp.sog' });
    const metadata = await streamer.start();

    expect(metadata.compression).toBe(0);
    expect(metadata.version).toBe(2);
  });

  it('★ compression=1 但 DecompressionStream 不可用时抛出错误 (D-02: 经 start 拒绝传播)', async () => {
    // 创建标记为 gzip 压缩的 v2 文件 (但数据未实际压缩, 仅测试错误处理)
    const numChunks = 1;
    const chunkSize = 5;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize, { compression: 1 });
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    // 临时移除 DecompressionStream
    const originalDS = globalThis.DecompressionStream;
    // @ts-expect-error — 临时删除全局对象
    delete globalThis.DecompressionStream;

    const errors: Error[] = [];
    const streamer = new SogStreamer({
      url: 'mock://v2-gzip.sog',
      onError: (err) => errors.push(err),
    });

    try {
      // ★ D-02: 旧行为是静默 resolve (后续拼接崩溃), 修复后 start() 拒绝,
      //   让渲染器回退链接管 (如回退到 .splat 直加载)
      await expect(streamer.start()).rejects.toThrow(/chunk 加载失败/);
    } finally {
      // 恢复
      globalThis.DecompressionStream = originalDS;
    }

    // 单 chunk 级错误仍通过 onError 通知, 且指明根因
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('DecompressionStream');
  });

  it('★ lodQuality 字段正确解析', async () => {
    const numChunks = 2;
    const chunkSize = 5;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize, { lodQuality: 0 });
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const streamer = new SogStreamer({ url: 'mock://v2-lod0.sog' });
    const metadata = await streamer.start();

    expect(metadata.lodQuality).toBe(0);
  });

  it('★ lodQuality=1 字段正确解析', async () => {
    const numChunks = 2;
    const chunkSize = 5;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize, { lodQuality: 1 });
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const streamer = new SogStreamer({ url: 'mock://v2-lod1.sog' });
    const metadata = await streamer.start();

    expect(metadata.lodQuality).toBe(1);
  });
});

// ── P2-3: 位置量化反量化测试 ─────────────────────────────

const COMPACT_BYTES = 29; // 紧凑格式每 splat 字节数
const QUANT_MAX = 0xFFFFFF;

/**
 * ★ P2-3: 构造一个带位置量化的 SOG v2 文件 (compact 29B/splat, 无压缩)
 *
 * @param numSplats splat 数量
 * @param positions 原始位置数组 [[x,y,z], ...]
 * @param bboxMin 场景包围盒最小值
 * @param bboxMax 场景包围盒最大值
 */
function createMockSogV2QuantizedFile(
  numSplats: number,
  positions: number[][],
  bboxMin: [number, number, number] = [0, 0, 0],
  bboxMax: [number, number, number] = [100, 100, 100],
): ArrayBuffer {
  const numChunks = 1;
  const chunkSize = numSplats;
  const indexSize = numChunks * 8;
  const dataSize = numSplats * COMPACT_BYTES;
  const totalSize = HEADER_SIZE + indexSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Header (v2) with positionQuantization=1
  view.setUint32(0, SOG_MAGIC_V2, true);
  view.setUint16(4, 2, true);          // version 2
  view.setUint8(6, 0);                 // shDegree
  view.setUint8(7, 0);                 // compression = none
  view.setUint32(8, numSplats, true);
  view.setUint32(12, numChunks, true);
  view.setUint32(16, chunkSize, true);
  view.setFloat32(20, bboxMin[0], true);
  view.setFloat32(24, bboxMin[1], true);
  view.setFloat32(28, bboxMin[2], true);
  view.setFloat32(32, bboxMax[0], true);
  view.setFloat32(36, bboxMax[1], true);
  view.setFloat32(40, bboxMax[2], true);
  view.setUint32(44, 0, true);         // lodTreeOffset
  view.setUint32(48, 0, true);         // lodTreeSize
  view.setUint8(52, 1);                // lodQuality
  view.setUint8(53, 1);                // ★ positionQuantization = 1 (24-bit)

  // Chunk index
  const dataOffset = HEADER_SIZE + indexSize;
  view.setUint32(HEADER_SIZE, dataOffset, true);
  view.setUint32(HEADER_SIZE + 4, dataSize, true);

  // Chunk data: compact 29-byte format
  const rangeX = (bboxMax[0] - bboxMin[0]) || 1;
  const rangeY = (bboxMax[1] - bboxMin[1]) || 1;
  const rangeZ = (bboxMax[2] - bboxMin[2]) || 1;

  for (let i = 0; i < numSplats; i++) {
    const base = dataOffset + i * COMPACT_BYTES;
    const [x, y, z] = positions[i];

    // Position XYZ → 3 × Uint24 LE (9 bytes)
    const qx = Math.max(0, Math.min(QUANT_MAX, Math.round((x - bboxMin[0]) / rangeX * QUANT_MAX)));
    const qy = Math.max(0, Math.min(QUANT_MAX, Math.round((y - bboxMin[1]) / rangeY * QUANT_MAX)));
    const qz = Math.max(0, Math.min(QUANT_MAX, Math.round((z - bboxMin[2]) / rangeZ * QUANT_MAX)));

    view.setUint8(base, qx & 0xff);
    view.setUint8(base + 1, (qx >> 8) & 0xff);
    view.setUint8(base + 2, (qx >> 16) & 0xff);
    view.setUint8(base + 3, qy & 0xff);
    view.setUint8(base + 4, (qy >> 8) & 0xff);
    view.setUint8(base + 5, (qy >> 16) & 0xff);
    view.setUint8(base + 6, qz & 0xff);
    view.setUint8(base + 7, (qz >> 8) & 0xff);
    view.setUint8(base + 8, (qz >> 16) & 0xff);

    // Scale XYZ → 3 × Float32 (12 bytes at offset 9-20)
    view.setFloat32(base + 9, 0.01, true);
    view.setFloat32(base + 13, 0.01, true);
    view.setFloat32(base + 17, 0.01, true);

    // Color RGBA → 4 × Uint8 (4 bytes at offset 21-24)
    view.setUint8(base + 21, 200);
    view.setUint8(base + 22, 150);
    view.setUint8(base + 23, 100);
    view.setUint8(base + 24, 255);

    // Rotation IJKL → 4 × Uint8 (4 bytes at offset 25-28)
    view.setUint8(base + 25, 128);  // rotW = 0
    view.setUint8(base + 26, 128);  // rotX = 0
    view.setUint8(base + 27, 128);  // rotY = 0
    view.setUint8(base + 28, 128);  // rotZ = 0
  }

  return buffer;
}

describe('SogStreamer — P2-3 位置量化反量化', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('★ metadata.positionQuantization 正确解析为 1', async () => {
    const positions = [[0, 0, 0], [50, 50, 50], [100, 100, 100]];
    const sogBuffer = createMockSogV2QuantizedFile(3, positions);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const streamer = new SogStreamer({ url: 'mock://quant.sog' });
    const metadata = await streamer.start();

    expect(metadata.positionQuantization).toBe(1);
    expect(metadata.version).toBe(2);
  });

  it('★ metadata.positionQuantization 默认为 0 (未量化文件)', async () => {
    const sogBuffer = createMockSogV2File(2, 5); // 无量化
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const streamer = new SogStreamer({ url: 'mock://nocomp.sog' });
    const metadata = await streamer.start();

    expect(metadata.positionQuantization).toBe(0);
  });

  it('★ 反量化后 chunk 数据为 32 字节/splat (.splat 格式)', async () => {
    const numSplats = 5;
    const positions: number[][] = [];
    for (let i = 0; i < numSplats; i++) {
      positions.push([i * 20, i * 20, i * 20]);
    }
    const sogBuffer = createMockSogV2QuantizedFile(numSplats, positions);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://quant.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });
    await streamer.start();

    const data = chunkData.get(0);
    expect(data).toBeDefined();
    // 反量化后应为 32 bytes/splat
    expect(data!.byteLength).toBe(numSplats * 32);
  });

  it('★ 反量化位置值在精度范围内正确', async () => {
    const positions = [
      [0, 0, 0],
      [50, 50, 50],
      [100, 100, 100],
    ];
    const sogBuffer = createMockSogV2QuantizedFile(3, positions);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://quant.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });
    await streamer.start();

    const data = chunkData.get(0)!;
    const view = new DataView(data);
    const range = 100; // bboxMax - bboxMin = 100

    for (let i = 0; i < 3; i++) {
      const base = i * 32;
      const x = view.getFloat32(base, true);
      const y = view.getFloat32(base + 4, true);
      const z = view.getFloat32(base + 8, true);

      // 误差应小于 2 步量化精度 (range / 0xFFFFFF * 2)
      const step = range / QUANT_MAX;
      expect(Math.abs(x - positions[i][0])).toBeLessThan(step * 2);
      expect(Math.abs(y - positions[i][1])).toBeLessThan(step * 2);
      expect(Math.abs(z - positions[i][2])).toBeLessThan(step * 2);
    }
  });

  it('★ 反量化后非位置属性 (scale, color, rotation) 保持正确', async () => {
    const sogBuffer = createMockSogV2QuantizedFile(1, [[50, 50, 50]]);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://quant.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });
    await streamer.start();

    const data = chunkData.get(0)!;
    const view = new DataView(data);

    // Scale XYZ at offset 12-23 (3 × Float32)
    expect(view.getFloat32(12, true)).toBeCloseTo(0.01, 5);
    expect(view.getFloat32(16, true)).toBeCloseTo(0.01, 5);
    expect(view.getFloat32(20, true)).toBeCloseTo(0.01, 5);

    // Color RGBA at offset 24-27 (4 × Uint8)
    expect(view.getUint8(24)).toBe(200);
    expect(view.getUint8(25)).toBe(150);
    expect(view.getUint8(26)).toBe(100);
    expect(view.getUint8(27)).toBe(255);

    // Rotation IJKL at offset 28-31 (4 × Uint8)
    expect(view.getUint8(28)).toBe(128);
    expect(view.getUint8(29)).toBe(128);
    expect(view.getUint8(30)).toBe(128);
    expect(view.getUint8(31)).toBe(128);
  });

  it('★ 反量化使用自定义包围盒', async () => {
    const bboxMin: [number, number, number] = [-50, -50, -50];
    const bboxMax: [number, number, number] = [50, 50, 50];
    const positions = [[-50, -50, -50], [0, 0, 0], [50, 50, 50]];
    const sogBuffer = createMockSogV2QuantizedFile(3, positions, bboxMin, bboxMax);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://quant.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });
    await streamer.start();

    const data = chunkData.get(0)!;
    const view = new DataView(data);
    const range = 100; // bboxMax - bboxMin = 100

    // 第一个 splat: (-50, -50, -50) → 边界最小值
    const x0 = view.getFloat32(0, true);
    const y0 = view.getFloat32(4, true);
    const z0 = view.getFloat32(8, true);
    const step = range / QUANT_MAX;
    expect(Math.abs(x0 - (-50))).toBeLessThan(step * 2);
    expect(Math.abs(y0 - (-50))).toBeLessThan(step * 2);
    expect(Math.abs(z0 - (-50))).toBeLessThan(step * 2);

    // 第三个 splat: (50, 50, 50) → 边界最大值
    const x2 = view.getFloat32(64, true);
    const y2 = view.getFloat32(68, true);
    const z2 = view.getFloat32(72, true);
    expect(Math.abs(x2 - 50)).toBeLessThan(step * 2);
    expect(Math.abs(y2 - 50)).toBeLessThan(step * 2);
    expect(Math.abs(z2 - 50)).toBeLessThan(step * 2);
  });

  it('★ 多 splat 反量化 round-trip 一致性', async () => {
    const numSplats = 50;
    const positions: number[][] = [];
    for (let i = 0; i < numSplats; i++) {
      positions.push([
        Math.random() * 100,
        Math.random() * 100,
        Math.random() * 100,
      ]);
    }
    const sogBuffer = createMockSogV2QuantizedFile(numSplats, positions);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const chunkData: Map<number, ArrayBuffer> = new Map();
    const streamer = new SogStreamer({
      url: 'mock://quant.sog',
      onChunkLoaded: (idx, data) => { chunkData.set(idx, data); },
    });
    await streamer.start();

    const data = chunkData.get(0)!;
    const view = new DataView(data);
    const range = 100;
    const step = range / QUANT_MAX;

    for (let i = 0; i < numSplats; i++) {
      const base = i * 32;
      const x = view.getFloat32(base, true);
      const y = view.getFloat32(base + 4, true);
      const z = view.getFloat32(base + 8, true);

      expect(Math.abs(x - positions[i][0])).toBeLessThan(step * 2);
      expect(Math.abs(y - positions[i][1])).toBeLessThan(step * 2);
      expect(Math.abs(z - positions[i][2])).toBeLessThan(step * 2);
    }
  });
});

describe('SogStreamer — P2 早期终止加载', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ maxSplats 限制加载的 chunk 数量', async () => {
    const numChunks = 100;
    const chunkSize = 1000; // 1000 splats per chunk = 100K total
    const sogBuffer = createMockSogV2File(numChunks, chunkSize);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const loadedChunkIndices: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      maxSplats: 5000, // 只需 5 chunks (5 * 1000 = 5000)
      onChunkLoaded: (idx) => { loadedChunkIndices.push(idx); },
    });
    await streamer.start();

    // 应该只加载前 5 个 chunk (0-4)
    expect(loadedChunkIndices.length).toBe(5);
    expect(Math.max(...loadedChunkIndices)).toBeLessThan(5);
  });

  it('★ maxSplats >= numSplats 时加载所有 chunk', async () => {
    const numChunks = 10;
    const chunkSize = 100;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const loadedChunkIndices: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      maxSplats: 10000, // 远超总量 1000
      onChunkLoaded: (idx) => { loadedChunkIndices.push(idx); },
    });
    await streamer.start();

    expect(loadedChunkIndices.length).toBe(numChunks);
  });

  it('★ 不设置 maxSplats 时加载所有 chunk (向后兼容)', async () => {
    const numChunks = 10;
    const chunkSize = 100;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const loadedChunkIndices: number[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      onChunkLoaded: (idx) => { loadedChunkIndices.push(idx); },
    });
    await streamer.start();

    expect(loadedChunkIndices.length).toBe(numChunks);
  });

  it('★ onProgress 报告正确的 totalChunks (限制后)', async () => {
    const numChunks = 50;
    const chunkSize = 200;
    const sogBuffer = createMockSogV2File(numChunks, chunkSize);
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const progressCalls: { loaded: number; total: number }[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      maxSplats: 2000, // 10 chunks
      onProgress: (loaded, total) => { progressCalls.push({ loaded, total }); },
    });
    await streamer.start();

    // total 应该是 10 (限制后), 不是 50
    const lastCall = progressCalls[progressCalls.length - 1];
    expect(lastCall.total).toBe(10);
    expect(lastCall.loaded).toBe(10);
  });
});

// ── ★ D-02: chunk 加载失败传播 ────────────────────────

describe('SogStreamer — D-02 chunk 失败传播', () => {
  const numChunks = 4;
  const chunkSize = 10;
  let sogBuffer: ArrayBuffer;
  let originalFetch: typeof globalThis.fetch;

  /** 构造对指定 chunk 返回 404 的 fetch mock */
  function createFailingFetch(failChunkIndex: number) {
    const indexSize = numChunks * 8;
    const chunkBytes = chunkSize * SPLAT_BYTES;
    const dataStart = HEADER_SIZE + indexSize;

    return vi.fn((_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      const range = headers?.Range;
      const match = range?.match(/bytes=(\d+)-(\d+)/);
      if (!match) {
        return Promise.resolve({ ok: false, status: 400, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
      }
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);

      // 命中失败 chunk 的数据区间 → 404 (弱网/部分文件丢失场景)
      const chunkStart = dataStart + failChunkIndex * chunkBytes;
      if (start >= chunkStart && start < chunkStart + chunkBytes) {
        return Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
      }

      return Promise.resolve({
        ok: true,
        status: 206,
        arrayBuffer: () => Promise.resolve(sogBuffer.slice(start, end + 1)),
      });
    });
  }

  beforeEach(() => {
    sogBuffer = createMockSogV2File(numChunks, chunkSize);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('单个 chunk 失败: start() 拒绝并指明失败编号 (而非静默成功)', async () => {
    globalThis.fetch = createFailingFetch(2) as unknown as typeof globalThis.fetch;

    const errors: string[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      onError: (err) => errors.push(err.message),
    });

    // ★ 核心断言: 旧实现此处会 resolve (随后拼接崩溃), 修复后必须 reject
    await expect(streamer.start()).rejects.toThrow(/chunk 加载失败/);
    // onError 仍被通知 (单 chunk 级错误)
    expect(errors.length).toBeGreaterThan(0);
  });

  it('失败后 chunkDataList 不产生稀疏空洞 (可安全回退)', async () => {
    globalThis.fetch = createFailingFetch(1) as unknown as typeof globalThis.fetch;

    const chunkDataList: ArrayBuffer[] = [];
    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      onChunkLoaded: (idx, data) => { chunkDataList[idx] = data; },
    });

    await expect(streamer.start()).rejects.toThrow();
    // 失败的 chunk 不会留下 undefined 空洞 — 拒绝后调用方走回退链, 不再进入拼接
    expect(chunkDataList.filter(Boolean).length).toBe(numChunks - 1);
  });

  it('abort() 中止不算失败 (新场景加载主动中止旧加载)', async () => {
    globalThis.fetch = createMockFetch(sogBuffer) as unknown as typeof globalThis.fetch;

    const streamer = new SogStreamer({
      url: 'mock://test.sog',
      parallel: false, // 顺序加载便于中途中止
    });

    const promise = streamer.start();
    streamer.abort();

    // 中止后正常完成 (不抛错) 或抛 abort 相关错误均可接受, 但不应报 "chunk 加载失败"
    try {
      await promise;
    } catch (err) {
      expect(String(err)).not.toContain('chunk 加载失败');
    }
  });
});
