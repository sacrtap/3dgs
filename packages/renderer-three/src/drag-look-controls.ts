/**
 * DragLookControls — 拖拽式视角控制 (替代 OrbitControls)
 *
 * 交互方式 (类似 krpano / 全景查看器):
 *   拖拽   → 旋转视角 (原地转头, 不绕远处的点旋转)
 *   滚轮   → 沿视线方向前进/后退
 *
 * 与 OrbitControls 的区别:
 *   OrbitControls: 相机绕 target 点做球面运动 (有视差, 漫游时不自然)
 *   DragLookControls: 相机原地旋转 (无视差, 像转头看, 全景漫游更自然)
 */

import * as THREE from 'three';

export class DragLookControls {
  /** 兼容属性: 始终 = camera.position + forward (供外部读取) */
  readonly target = new THREE.Vector3();

  enableDamping = true;
  dampingFactor = 0.12;

  /** 旋转灵敏度 (弧度/像素) */
  rotateSpeed = 0.003;

  /** 滚轮移动速度 (每 deltaY 单位的位移量) */
  wheelSpeed = 0.5;

  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  // Euler 角 (YXZ 顺序: yaw, pitch, roll)
  private _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _targetEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  // 指针状态
  private _pointerActive = false;
  private _pointerId = -1;
  private _lastX = 0;
  private _lastY = 0;

  // 事件处理器引用 (供 dispose)
  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp: (e: PointerEvent) => void;
  private _onWheel: (e: WheelEvent) => void;
  private _onContextMenu: (e: Event) => void;

  // 临时向量
  private _tmpForward = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    // 从相机当前朝向初始化 euler
    this._euler.setFromQuaternion(camera.quaternion, 'YXZ');
    this._targetEuler.copy(this._euler);

    this._onPointerDown = (e: PointerEvent) => {
      this._pointerActive = true;
      this._pointerId = e.pointerId;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      try { domElement.setPointerCapture(e.pointerId); } catch { /* 安全 */ }
    };

    this._onPointerMove = (e: PointerEvent) => {
      if (!this._pointerActive || e.pointerId !== this._pointerId) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      this._targetEuler.y += dx * this.rotateSpeed;
      this._targetEuler.x += dy * this.rotateSpeed;

      // 限制 pitch 避免 gimbal lock
      const limit = Math.PI / 2 - 0.05;
      this._targetEuler.x = Math.max(-limit, Math.min(limit, this._targetEuler.x));
    };

    this._onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this._pointerId) return;
      this._pointerActive = false;
      this._pointerId = -1;
      try { domElement.releasePointerCapture(e.pointerId); } catch { /* 安全 */ }
    };

    this._onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this._tmpForward.set(0, 0, -1).applyEuler(this._euler);
      this.camera.position.addScaledVector(this._tmpForward, -e.deltaY * this.wheelSpeed * 0.01);
    };

    this._onContextMenu = (e: Event) => e.preventDefault();

    domElement.addEventListener('pointerdown', this._onPointerDown);
    domElement.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('pointerup', this._onPointerUp);
    domElement.addEventListener('pointercancel', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  /** 设置旋转灵敏度 */
  setRotateSpeed(speed: number): void {
    this.rotateSpeed = speed;
  }

  /** 设置滚轮速度 */
  setWheelSpeed(speed: number): void {
    this.wheelSpeed = speed;
  }

  /**
   * 让相机看向指定点 (设置 yaw/pitch)
   * 用于加载场景后自动定位视角
   */
  lookAt(targetX: number, targetY: number, targetZ: number): void {
    this.camera.lookAt(targetX, targetY, targetZ);
    this._euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this._targetEuler.copy(this._euler);
  }

  /** 每帧更新: 应用阻尼, 更新相机朝向, 同步 target */
  update(): void {
    if (this.enableDamping) {
      this._euler.x += (this._targetEuler.x - this._euler.x) * this.dampingFactor;
      this._euler.y += (this._targetEuler.y - this._euler.y) * this.dampingFactor;
    } else {
      this._euler.copy(this._targetEuler);
    }

    this.camera.quaternion.setFromEuler(this._euler);

    // 同步 target = camera.position + forward (供外部读取)
    this._tmpForward.set(0, 0, -1).applyEuler(this._euler);
    this.target.copy(this.camera.position).add(this._tmpForward);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('pointercancel', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    this._pointerActive = false;
  }
}
