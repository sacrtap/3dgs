/**
 * PerformanceMonitor — 浏览器端性能监控工具
 *
 * 使用 Performance API 采集 FPS、帧时间、内存等指标，
 * 可嵌入 Demo 或应用中实时监控渲染性能。
 *
 * 用法:
 *   import { PerformanceMonitor } from './benchmarks/perf-monitor';
 *   const monitor = new PerformanceMonitor(renderer);
 *   monitor.start();
 *   // ... 运行一段时间后
 *   const report = monitor.stop();
 *   console.log(report);
 *
 * [来源: Performance API — developer.mozilla.org/en-US/docs/Web/API/Performance_API]
 */

/** 性能采样数据点 */
export interface PerfSample {
  /** 时间戳 (ms, 相对于 monitor 启动) */
  time: number;
  /** 帧间隔 (ms) */
  frameTime: number;
  /** 瞬时 FPS */
  fps: number;
  /** JS 堆内存 (MB, 如可用) */
  jsHeapMB?: number;
}

/** 性能报告 */
export interface PerfReport {
  /** 采样数 */
  sampleCount: number;
  /** 监控持续时间 (ms) */
  duration: number;
  /** 平均 FPS */
  avgFps: number;
  /** 最低 FPS (P5) */
  p5Fps: number;
  /** 中位数 FPS (P50) */
  p50Fps: number;
  /** 95 分位 FPS (P95) */
  p95Fps: number;
  /** 平均帧时间 (ms) */
  avgFrameTime: number;
  /** 最大帧时间 (ms) */
  maxFrameTime: number;
  /** P95 帧时间 (ms) */
  p95FrameTime: number;
  /** 帧时间标准差 (ms) */
  stdFrameTime: number;
  /** 丢帧数 (帧时间 > 20ms) */
  droppedFrames: number;
  /** 丢帧率 (%) */
  droppedFrameRate: number;
  /** 平均 JS 堆内存 (MB, 如可用) */
  avgJsHeapMB?: number;
  /** 峰值 JS 堆内存 (MB, 如可用) */
  peakJsHeapMB?: number;
  /** 所有采样数据 (可用于绘制图表) */
  samples: PerfSample[];
}

/** 性能监控选项 */
export interface PerformanceMonitorOptions {
  /** 采样间隔 (帧数, 默认每帧采样) */
  sampleInterval?: number;
  /** 丢帧阈值 (ms, 超过此值视为丢帧, 默认 20ms ≈ <50fps) */
  droppedFrameThreshold?: number;
  /** 是否记录内存 (默认 true, 需要 performance.memory 支持) */
  trackMemory?: boolean;
}

/**
 * 性能监控器
 *
 * 通过渲染器的 onFrame() 回调挂载到单一 RAF 循环,
 * 每帧采集帧时间和内存数据, 最终生成统计报告。
 */
export class PerformanceMonitor {
  private options: Required<PerformanceMonitorOptions>;
  private samples: PerfSample[] = [];
  private startTime = 0;
  private lastFrameTime = 0;
  private frameCount = 0;
  private running = false;
  private unsub?: () => void;

  constructor(
    renderer: { onFrame(callback: (deltaTime: number) => void): () => void },
    options: PerformanceMonitorOptions = {},
  ) {
    this.options = {
      sampleInterval: options.sampleInterval ?? 1,
      droppedFrameThreshold: options.droppedFrameThreshold ?? 20,
      trackMemory: options.trackMemory ?? true,
    };
  }

  /** 开始监控 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.samples = [];
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.frameCount = 0;
  }

  /** 停止监控并生成报告 */
  stop(): PerfReport {
    this.running = false;
    return this.generateReport();
  }

  /** 获取当前采样数 */
  getSampleCount(): number {
    return this.samples.length;
  }

  /** 获取当前实时 FPS */
  getCurrentFps(): number {
    if (this.samples.length === 0) return 0;
    return this.samples[this.samples.length - 1].fps;
  }

  /** 采集一帧数据 (由外部调用) */
  sample(deltaTime: number): void {
    if (!this.running) return;

    this.frameCount++;
    if (this.frameCount % this.options.sampleInterval !== 0) return;

    const now = performance.now();
    const time = now - this.startTime;

    const sample: PerfSample = {
      time,
      frameTime: deltaTime,
      fps: deltaTime > 0 ? 1000 / deltaTime : 0,
    };

    if (this.options.trackMemory) {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) {
        sample.jsHeapMB = mem.usedJSHeapSize / 1024 / 1024;
      }
    }

    this.samples.push(sample);
  }

  /** 生成统计报告 */
  private generateReport(): PerfReport {
    const samples = this.samples;
    const count = samples.length;

    if (count === 0) {
      return {
        sampleCount: 0,
        duration: 0,
        avgFps: 0,
        p5Fps: 0,
        p50Fps: 0,
        p95Fps: 0,
        avgFrameTime: 0,
        maxFrameTime: 0,
        p95FrameTime: 0,
        stdFrameTime: 0,
        droppedFrames: 0,
        droppedFrameRate: 0,
        samples: [],
      };
    }

    const fpsValues = samples.map((s) => s.fps).sort((a, b) => a - b);
    const frameTimes = samples.map((s) => s.frameTime).sort((a, b) => a - b);
    const duration = samples[samples.length - 1].time - samples[0].time;

    const avgFps = fpsValues.reduce((a, b) => a + b, 0) / count;
    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / count;

    // 标准差
    const variance = frameTimes.reduce((sum, ft) => sum + (ft - avgFrameTime) ** 2, 0) / count;
    const stdFrameTime = Math.sqrt(variance);

    // 丢帧统计
    const droppedFrames = samples.filter(
      (s) => s.frameTime > this.options.droppedFrameThreshold,
    ).length;

    // 内存统计
    const memSamples = samples.filter((s) => s.jsHeapMB !== undefined) as Required<PerfSample>[];
    const avgJsHeapMB = memSamples.length > 0
      ? memSamples.reduce((sum, s) => sum + s.jsHeapMB, 0) / memSamples.length
      : undefined;
    const peakJsHeapMB = memSamples.length > 0
      ? Math.max(...memSamples.map((s) => s.jsHeapMB))
      : undefined;

    return {
      sampleCount: count,
      duration,
      avgFps: Math.round(avgFps * 10) / 10,
      p5Fps: Math.round(percentile(fpsValues, 5) * 10) / 10,
      p50Fps: Math.round(percentile(fpsValues, 50) * 10) / 10,
      p95Fps: Math.round(percentile(fpsValues, 95) * 10) / 10,
      avgFrameTime: Math.round(avgFrameTime * 100) / 100,
      maxFrameTime: Math.round(frameTimes[frameTimes.length - 1] * 100) / 100,
      p95FrameTime: Math.round(percentile(frameTimes, 95) * 100) / 100,
      stdFrameTime: Math.round(stdFrameTime * 100) / 100,
      droppedFrames,
      droppedFrameRate: Math.round((droppedFrames / count) * 1000) / 10,
      avgJsHeapMB: avgJsHeapMB !== undefined ? Math.round(avgJsHeapMB * 100) / 100 : undefined,
      peakJsHeapMB: peakJsHeapMB !== undefined ? Math.round(peakJsHeapMB * 100) / 100 : undefined,
      samples,
    };
  }
}

/** 计算百分位数 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}
