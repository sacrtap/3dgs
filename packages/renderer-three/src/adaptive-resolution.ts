/**
 * AdaptiveResolution — 自适应分辨率
 *
 * 监控帧率，当 FPS 持续低于阈值时降低渲染分辨率，
 * 当 FPS 持续高于阈值时尝试恢复分辨率。
 *
 * 这保证了在低端设备上也能保持流畅的交互体验
 */

export interface AdaptiveResolutionOptions {
  /** 最低可接受的帧率 (默认 28) — 低于此值时降低分辨率 */
  minFps: number;
  /** 认为流畅的帧率 (默认 45) — 高于此值时尝试恢复分辨率 */
  targetFps: number;
  /** 最低分辨率缩放比 (默认 0.35) */
  minScale: number;
  /** 最高分辨率缩放比 (默认 1.0) */
  maxScale: number;
  /** 调整间隔帧数 (默认 45 帧 ≈ 0.75 秒) */
  adjustInterval: number;
  /** 每次调整的步长 (默认 0.1) */
  step: number;
}

export class AdaptiveResolution {
  private opts: AdaptiveResolutionOptions;
  private currentScale: number;
  private frameCount = 0;
  private fpsSamples: number[] = [];
  private lastTime = performance.now();
  private onScaleChange?: (scale: number) => void;
  // ★ §2.5/N-06: 暂停标志 — 加载/LOD 构建期间不采样, 防止低帧率误降分辨率
  private _suspended = false;

  constructor(
    initialScale: number,
    onScaleChange: (scale: number) => void,
    options?: Partial<AdaptiveResolutionOptions>,
  ) {
    this.opts = {
      minFps: options?.minFps ?? 28,
      targetFps: options?.targetFps ?? 45,
      minScale: options?.minScale ?? 0.35,
      maxScale: options?.maxScale ?? 1.0,
      adjustInterval: options?.adjustInterval ?? 45,
      step: options?.step ?? 0.1,
    };
    this.currentScale = Math.max(this.opts.minScale, Math.min(this.opts.maxScale, initialScale));
    this.onScaleChange = onScaleChange;
  }

  /** 每帧调用 — 采样帧率并适时调整分辨率 */
  sample(): void {
    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;

    // ★ §2.5/N-06: 暂停期间仅维护时间基准, 不采样不调整,
    //   避免加载期低帧率把分辨率降下去后缓慢回升导致首屏长时间低画质
    if (this._suspended) return;

    if (dt > 0 && dt < 1000) {
      this.fpsSamples.push(1000 / dt);
    }

    this.frameCount++;

    if (this.frameCount >= this.opts.adjustInterval) {
      this.adjust();
      this.frameCount = 0;
      this.fpsSamples = [];
    }
  }

  get currentResolutionScale(): number {
    return this.currentScale;
  }

  /** 强制设置分辨率 */
  setScale(scale: number): void {
    this.currentScale = Math.max(this.opts.minScale, Math.min(this.opts.maxScale, scale));
    this.onScaleChange?.(this.currentScale);
  }

  /**
   * ★ §2.5/N-06: 暂停采样 (加载期/页面隐藏时调用)
   *
   * 暂停期间 sample() 仅维护时间基准, 不记录帧率也不调整分辨率。
   */
  suspend(): void {
    this._suspended = true;
  }

  /**
   * ★ §2.5/N-06: 恢复采样 — 重置时间基准与样本窗口,
   * 避免暂停期间累积的陈旧样本干扰决策。
   */
  resume(): void {
    this._suspended = false;
    this.lastTime = performance.now();
    this.fpsSamples = [];
    this.frameCount = 0;
  }

  /** 是否处于暂停状态 */
  get suspended(): boolean {
    return this._suspended;
  }

  // ─── 内部 ────────────────────────────────────────────────

  private adjust(): void {
    if (this.fpsSamples.length < 10) return;

    const avgFps =
      this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;

    if (avgFps < this.opts.minFps && this.currentScale > this.opts.minScale) {
      // 帧率过低 — 降低分辨率
      const newScale = Math.max(
        this.opts.minScale,
        this.currentScale - this.opts.step,
      );
      if (newScale !== this.currentScale) {
        this.currentScale = newScale;
        this.onScaleChange?.(this.currentScale);
      }
    } else if (avgFps > this.opts.targetFps && this.currentScale < this.opts.maxScale) {
      // 帧率充足 — 尝试恢复分辨率
      const newScale = Math.min(
        this.opts.maxScale,
        this.currentScale + this.opts.step,
      );
      if (newScale !== this.currentScale) {
        this.currentScale = newScale;
        this.onScaleChange?.(this.currentScale);
      }
    }
  }
}
