import { describe, it, expect } from 'vitest';
import { pruneGaussians, mortonSortGaussians } from './processing.js';
import type { GaussianCloud } from './gaussian-loader.js';

function makeCloud(splats: Array<Partial<import('./gaussian-loader.js').GaussianSplat>>): GaussianCloud {
  return {
    splats: splats.map((s) => ({
      x: s.x ?? 0,
      y: s.y ?? 0,
      z: s.z ?? 0,
      scaleX: s.scaleX ?? 0.01,
      scaleY: s.scaleY ?? 0.01,
      scaleZ: s.scaleZ ?? 0.01,
      rotW: s.rotW ?? 1,
      rotX: s.rotX ?? 0,
      rotY: s.rotY ?? 0,
      rotZ: s.rotZ ?? 0,
      colorR: s.colorR ?? 0.8,
      colorG: s.colorG ?? 0.8,
      colorB: s.colorB ?? 0.8,
      opacity: s.opacity ?? 1,
      shDegree: 0,
    })),
    shDegree: 0,
    vertexCount: splats.length,
    source: 'test',
  };
}

describe('pruneGaussians', () => {
  it('剔除低不透明度高斯核', () => {
    const cloud = makeCloud([
      { opacity: 0.5 },
      { opacity: 0.001 },
      { opacity: 0.8 },
    ]);

    const result = pruneGaussians(cloud, { minOpacity: 0.01 });
    expect(result.splats).toHaveLength(2);
  });

  it('剔除含 NaN 值的高斯核', () => {
    const cloud = makeCloud([
      { x: 0, y: 0, z: 0 },
      { x: NaN, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    ]);

    const result = pruneGaussians(cloud);
    expect(result.splats).toHaveLength(2);
  });

  it('剔除异常缩放的高斯核', () => {
    const cloud = makeCloud([
      { scaleX: 0.01, scaleY: 0.01, scaleZ: 0.01 },
      { scaleX: 100, scaleY: 0.01, scaleZ: 0.01 },
    ]);

    const result = pruneGaussians(cloud, { maxScale: 10 });
    expect(result.splats).toHaveLength(1);
  });

  it('空集输入返回空集', () => {
    const cloud = makeCloud([]);
    const result = pruneGaussians(cloud);
    expect(result.splats).toHaveLength(0);
  });
});

describe('mortonSortGaussians', () => {
  it('不改变高斯核数量', () => {
    const cloud = makeCloud([
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 5, y: 5, z: 5 },
    ]);

    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(4);
  });

  it('空间上邻近的高斯核在排序后也相邻', () => {
    const cloud = makeCloud([
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 9, y: 10, z: 10 },
    ]);

    const result = mortonSortGaussians(cloud);

    // (0,0,0) 应该排在最前面
    expect(result.splats[0].x).toBe(0);
    // (9,10,10) 和 (10,10,10) 应该相邻
    expect(result.splats[1].x).toBe(9);
    expect(result.splats[2].x).toBe(10);
  });

  it('空集输入返回空集', () => {
    const cloud = makeCloud([]);
    const result = mortonSortGaussians(cloud);
    expect(result.splats).toHaveLength(0);
  });
});
