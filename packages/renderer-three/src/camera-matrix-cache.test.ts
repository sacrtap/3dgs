/**
 * CameraMatrixCache 共享模块测试
 *
 * ★ M4: 验证从 RenderManager / WebGPURenderManager 提取的相机矩阵缓存逻辑
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraMatrixCache } from './camera-matrix-cache.js';

describe('CameraMatrixCache', () => {
  it('初始状态: vpMatrix 全零, camPos 原点', () => {
    const cache = new CameraMatrixCache();
    expect(cache.vpMatrix.every(v => v === 0)).toBe(true);
    expect(cache.camPos.x).toBe(0);
    expect(cache.camPos.y).toBe(0);
    expect(cache.camPos.z).toBe(0);
  });

  it('update 后 vpMatrix 非零', () => {
    const cache = new CameraMatrixCache();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    cache.update(camera);
    expect(cache.vpMatrix.some(v => v !== 0)).toBe(true);
  });

  it('update 后 camPos 反映相机世界坐标', () => {
    const cache = new CameraMatrixCache();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(3, 4, 5);
    camera.updateMatrixWorld();
    cache.update(camera);
    expect(cache.camPos.x).toBeCloseTo(3, 5);
    expect(cache.camPos.y).toBeCloseTo(4, 5);
    expect(cache.camPos.z).toBeCloseTo(5, 5);
  });

  it('vpMatrixTHREE 与 vpMatrix 内容一致', () => {
    const cache = new CameraMatrixCache();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(1, 2, 3);
    camera.lookAt(0, 0, 0);
    cache.update(camera);

    // Float32Array 与 Matrix4.elements 应该一致
    for (let i = 0; i < 16; i++) {
      expect(cache.vpMatrix[i]).toBeCloseTo(cache.vpMatrixTHREE.elements[i], 5);
    }
  });

  it('多次 update 不创建新对象 (零 GC)', () => {
    const cache = new CameraMatrixCache();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

    cache.update(camera);
    const vpRef = cache.vpMatrix;
    const posRef = cache.camPos;

    cache.update(camera);
    expect(cache.vpMatrix).toBe(vpRef);   // 同一引用
    expect(cache.camPos).toBe(posRef);     // 同一引用
  });

  it('相机移动后 camPos 更新', () => {
    const cache = new CameraMatrixCache();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

    camera.position.set(0, 0, 0);
    cache.update(camera);
    expect(cache.camPos.z).toBe(0);

    camera.position.set(0, 0, 10);
    cache.update(camera);
    expect(cache.camPos.z).toBeCloseTo(10, 5);
  });

  it('vpMatrixTHREE 可供 FrustumCulling 使用', () => {
    const cache = new CameraMatrixCache();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    cache.update(camera);

    // 使用 vpMatrixTHREE 构造 Frustum (模拟 FrustumCulling 用法)
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(cache.vpMatrixTHREE);

    // 原点应该在视锥内
    expect(frustum.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
    // 远处应该在视锥外
    expect(frustum.containsPoint(new THREE.Vector3(0, 0, 1000))).toBe(false);
  });
});
