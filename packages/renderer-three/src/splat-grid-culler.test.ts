/**
 * ★ TD-09: SplatGridCuller 单元测试
 *   - 全可见/部分可见/无假阴性 (保守裁剪)
 *   - 每个 splat 恰好归属一个 cell (构建正确性)
 *   - mask 与逐 splat 中心点测试的兼容关系
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SplatGridCuller } from './splat-grid-culler.js';

function makePositions(points: [number, number, number][]): Float32Array {
  const arr = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    arr[i * 3] = p[0];
    arr[i * 3 + 1] = p[1];
    arr[i * 3 + 2] = p[2];
  });
  return arr;
}

/** 从相机位置/朝向构建视锥 */
function makeFrustum(
  position: [number, number, number],
  lookAt: [number, number, number] = [0, 0, 0],
): THREE.Frustum {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

describe('SplatGridCuller — 空间分块视锥裁剪 (TD-09)', () => {
  it('全部 splat 在视锥内 → 全部可见', () => {
    const points: [number, number, number][] = [
      [-1, -1, -1],
      [1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [-1, 1, 1],
      [1, 1, 1],
    ];
    const culler = new SplatGridCuller(makePositions(points), points.length);
    const frustum = makeFrustum([0, 0, -10]);

    const mask = new Uint8Array(points.length);
    const visible = culler.cull(frustum, mask);

    expect(visible).toBe(points.length);
    expect(Array.from(mask).every((v) => v === 1)).toBe(true);
  });

  it('视锥外的 splat 被剔除 (无假阴性: mask=0 ⇒ 中心点在视锥外)', () => {
    // 原点附近 4 个点可见; 侧面 x=80 超出 fov; 前方 z=150 超出 far=100
    const points: [number, number, number][] = [
      [0, 0, 0],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, -0.5, -0.5],
      [80, 0, 0], // 侧面, fov 60° 之外
      [0, 0, 150], // 前方, 超出 far=100
    ];
    const culler = new SplatGridCuller(makePositions(points), points.length);
    const frustum = makeFrustum([0, 0, -10]);

    const mask = new Uint8Array(points.length);
    const visible = culler.cull(frustum, mask);

    // 前 4 个点可见
    for (let i = 0; i < 4; i++) {
      expect(mask[i]).toBe(1);
    }
    // 剔除的点 mask=0 且逐点测试确实不可见 (保守性: 无假阴性)
    for (let i = 4; i < points.length; i++) {
      expect(mask[i]).toBe(0);
      const p = new THREE.Vector3(points[i][0], points[i][1], points[i][2]);
      expect(frustum.containsPoint(p)).toBe(false);
    }
    expect(visible).toBe(4);
  });

  it('每个 splat 恰好归属一个 cell (members 总数 = count)', () => {
    // 随机散布 500 点 (确定性伪随机)
    const points: [number, number, number][] = [];
    for (let i = 0; i < 500; i++) {
      points.push([
        Math.sin(i * 12.9898) * 10,
        Math.cos(i * 78.233) * 10,
        Math.sin(i * 37.719) * 10,
      ]);
    }
    const culler = new SplatGridCuller(makePositions(points), points.length);

    const total = culler.cells.reduce((n, c) => n + c.members.length, 0);
    expect(total).toBe(points.length);

    // 每个 splat 只出现在一个 cell 中
    const seen = new Set<number>();
    for (const cell of culler.cells) {
      for (const idx of cell.members) {
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }
    }
    expect(seen.size).toBe(points.length);
  });

  it('逐点可见 ⇒ mask=1 (无假阴性, 兼容逐点测试)', () => {
    const points: [number, number, number][] = [];
    for (let i = 0; i < 300; i++) {
      points.push([Math.sin(i * 12.9898) * 8, Math.cos(i * 78.233) * 8, Math.sin(i * 37.719) * 8]);
    }
    const culler = new SplatGridCuller(makePositions(points), points.length);
    const frustum = makeFrustum([0, 0, -20]);

    const mask = new Uint8Array(points.length);
    culler.cull(frustum, mask);

    for (let i = 0; i < points.length; i++) {
      const p = new THREE.Vector3(points[i][0], points[i][1], points[i][2]);
      // 保守性: 中心点在视锥内的 splat 必须可见 (cell bbox 相交覆盖全部成员)
      if (frustum.containsPoint(p)) {
        expect(mask[i]).toBe(1);
      }
    }
  });
});
