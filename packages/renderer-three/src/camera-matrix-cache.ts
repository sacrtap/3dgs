/**
 * CameraMatrixCache — 相机矩阵缓存共享模块
 *
 * ★ M4: 从 RenderManager 和 WebGPURenderManager 提取的共享逻辑
 *
 * 功能:
 *   1. 缓存 View-Projection 矩阵 (Float32Array(16))
 *   2. 缓存相机世界坐标 {x, y, z}
 *   3. 每帧更新 (从 THREE.PerspectiveCamera 提取)
 *
 * 使用方式 (组合模式):
 * ```typescript
 * const matrixCache = new CameraMatrixCache();
 * // 每帧:
 * matrixCache.update(camera);
 * // 访问:
 * const vp = matrixCache.vpMatrix;      // Float32Array(16)
 * const pos = matrixCache.camPos;       // {x, y, z}
 * ```
 *
 * [来源: M4 重构 — 从 index.ts + webgpu-render-manager.ts 提取]
 */

import * as THREE from 'three';

export class CameraMatrixCache {
  /** View-Projection 矩阵 (列优先, 与 THREE.Matrix4.elements 一致) */
  readonly vpMatrix = new Float32Array(16);

  /** 相机世界坐标 */
  readonly camPos = { x: 0, y: 0, z: 0 };

  /** View-Projection 矩阵 (THREE.Matrix4 版本, 供 FrustumCulling 等需要 Matrix4 的消费者使用) */
  private _vpMatrixTHREE = new THREE.Matrix4();

  /** 临时对象 (避免每帧 GC) */
  private tmpV3 = new THREE.Vector3();

  /**
   * 从相机更新 VP 矩阵和相机坐标
   *
   * @param camera THREE.PerspectiveCamera
   */
  update(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();

    // 计算 View-Projection 矩阵
    this._vpMatrixTHREE.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._vpMatrixTHREE.toArray(this.vpMatrix);

    // 提取相机世界坐标
    camera.getWorldPosition(this.tmpV3);
    this.camPos.x = this.tmpV3.x;
    this.camPos.y = this.tmpV3.y;
    this.camPos.z = this.tmpV3.z;
  }

  /** 获取 VP 矩阵的 THREE.Matrix4 版本 (供 FrustumCulling 等消费者使用) */
  get vpMatrixTHREE(): THREE.Matrix4 {
    return this._vpMatrixTHREE;
  }
}
