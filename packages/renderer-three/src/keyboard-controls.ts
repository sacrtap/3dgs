/**
 * KeyboardControls — 键盘移动控制共享模块
 *
 * ★ M4: 从 RenderManager 和 WebGPURenderManager 提取的共享逻辑
 *
 * 功能:
 *   1. 监听 WASD+QE 键盘事件, 追踪按键状态
 *   2. 连续指数平滑移动 (帧率无关)
 *   3. 本地空间平移 (translateX/Y/Z, 自动跟随相机朝向)
 *
 * 使用方式 (组合模式):
 * ```typescript
 * const controls = new KeyboardControls({ moveSpeed: 5.0, verticalSpeed: 3.0 });
 * controls.setup(); // 开始监听
 * // 每帧:
 * controls.applyMovement(camera, dtMs);
 * // 销毁:
 * controls.teardown();
 * ```
 *
 * [来源: M4 重构 — 从 index.ts + webgpu-render-manager.ts 提取]
 */

import * as THREE from 'three';

/** 移动平滑时间常数 (秒) — 控制加速/减速的平滑程度
 *  τ=0.08s: 约 80ms 达到 63% 目标速度, 约 240ms 达到 95%
 *  越小越灵敏, 越大越平滑
 */
const MOVE_TIME_CONSTANT = 0.08;

/** 支持的移动按键集合 */
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

/** KeyboardControls 配置选项 */
export interface KeyboardControlsOptions {
  /** 键盘移动速度 */
  moveSpeed?: number;
  /** 键盘升降速度 */
  verticalSpeed?: number;
  /** 是否启用 (默认 true) */
  enabled?: boolean;
}

/**
 * 键盘移动控制器 — 可组合到任何渲染管理器中
 *
 * 原理:
 *   1. 按键状态 → 目标速度 (本地空间: x=右, y=上, z=前)
 *   2. 连续指数插值: currentVel += (targetVel - currentVel) × (1 - exp(-dt/τ))
 *   3. 本地空间平移: camera.translateX/Y/Z
 *
 * 优势:
 *   - 帧率无关: 30fps / 60fps / 144fps 下加速度曲线精确一致
 *   - 无量化跳变: 每帧连续更新
 *   - 方向无抖动: translateX/Y/Z 使用相机本地坐标系
 */
export class KeyboardControls {
  /** 当前按下的键 */
  private keysDown = new Set<string>();
  /** 是否启用 */
  private _enabled: boolean;
  /** 移动速度 */
  private _moveSpeed: number;
  /** 升降速度 */
  private _verticalSpeed: number;

  /** 事件处理器 */
  private _keyHandler?: (e: KeyboardEvent) => void;
  private _keyUpHandler?: (e: KeyboardEvent) => void;
  private _blurHandler?: () => void;

  /** 速度平滑: 当前速度向量 (连续指数插值) */
  private _currentVel = new THREE.Vector3();
  private _targetVel = new THREE.Vector3();

  constructor(options: KeyboardControlsOptions = {}) {
    this._enabled = options.enabled ?? true;
    this._moveSpeed = options.moveSpeed ?? 5.0;
    this._verticalSpeed = options.verticalSpeed ?? 3.0;
  }

  /** 开始监听键盘事件 */
  setup(): void {
    if (this._keyHandler) return;

    this._keyHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (MOVE_KEYS.has(key)) {
        this.keysDown.add(key);
        e.preventDefault();
      }
    };

    this._keyUpHandler = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };

    this._blurHandler = () => {
      this.keysDown.clear();
    };

    window.addEventListener('keydown', this._keyHandler);
    window.addEventListener('keyup', this._keyUpHandler);
    window.addEventListener('blur', this._blurHandler);
  }

  /** 停止监听并清理状态 */
  teardown(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = undefined;
    }
    if (this._keyUpHandler) {
      window.removeEventListener('keyup', this._keyUpHandler);
      this._keyUpHandler = undefined;
    }
    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
      this._blurHandler = undefined;
    }
    this.keysDown.clear();
    this._currentVel.set(0, 0, 0);
  }

  /**
   * 连续指数平滑移动 — 每帧调用
   *
   * @param camera 目标相机
   * @param dtMs 帧间隔 (毫秒)
   */
  applyMovement(camera: THREE.PerspectiveCamera, dtMs: number): void {
    const dt = dtMs / 1000;

    // ── 1. 计算目标速度 (本地空间) ──
    this._targetVel.set(0, 0, 0);

    if (this.keysDown.size > 0) {
      // 前后 (W/S) → 本地 Z 轴
      if (this.keysDown.has('w')) this._targetVel.z -= this._moveSpeed;
      if (this.keysDown.has('s')) this._targetVel.z += this._moveSpeed;
      // 左右 (A/D) → 本地 X 轴
      if (this.keysDown.has('a')) this._targetVel.x -= this._moveSpeed;
      if (this.keysDown.has('d')) this._targetVel.x += this._moveSpeed;
      // 升降 (Q/E) → 世界 Y 轴
      if (this.keysDown.has('q')) this._targetVel.y += this._verticalSpeed;
      if (this.keysDown.has('e')) this._targetVel.y -= this._verticalSpeed;
    }

    // ── 2. 连续指数平滑 (帧率无关) ──
    const alpha = 1 - Math.exp(-dt / MOVE_TIME_CONSTANT);
    this._currentVel.lerp(this._targetVel, alpha);

    if (this.keysDown.size === 0 && this._currentVel.lengthSq() < 1e-8) {
      this._currentVel.set(0, 0, 0);
      return;
    }

    // ── 3. 本地空间平移 ──
    camera.translateX(this._currentVel.x * dt);
    camera.translateY(this._currentVel.y * dt);
    camera.translateZ(this._currentVel.z * dt);
  }

  // ─── 公开 API ──────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (enabled) {
      this.setup();
    } else {
      this.teardown();
    }
  }

  setMoveSpeed(speed: number): void {
    this._moveSpeed = speed;
  }

  setVerticalSpeed(speed: number): void {
    this._verticalSpeed = speed;
  }

  getActiveMoveKeys(): string[] {
    return Array.from(this.keysDown);
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  get moveSpeed(): number {
    return this._moveSpeed;
  }

  get verticalSpeed(): number {
    return this._verticalSpeed;
  }
}
