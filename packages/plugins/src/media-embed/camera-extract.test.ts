import { describe, it, expect } from 'vitest';
import {
  extractCameraPose,
  worldToCameraCSS,
  buildWorldToCSSMatrix,
  billboardAxes,
  fixedAxes,
  toCSSMatrix3d,
} from './camera-extract.js';

// ── 矩阵构造工具 (three.js 约定, column-major) ──────────────

/** 透视投影矩阵: p1 = 1/tan(fovY/2) */
function perspective(fovYDeg: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan((fovYDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

/** 视图矩阵: 相机位置 + 绕世界 Y 的 yaw (度) */
function viewMatrix(pos: [number, number, number], yawDeg: number): number[] {
  const yaw = (yawDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Rc 的列 = 相机轴: x=(cos,0,-sin), y=(0,1,0), z=(sin,0,cos)
  // V = [Rcᵀ | -Rcᵀ·pos]
  const t0 = -(cos * pos[0] + 0 * pos[1] + sin * pos[2]);
  const t1 = -(0 * pos[0] + 1 * pos[1] + 0 * pos[2]);
  const t2 = -(-sin * pos[0] + 0 * pos[1] + cos * pos[2]);
  return [
    cos, 0, sin, 0,
    0, 1, 0, 0,
    -sin, 0, cos, 0,
    t0, t1, t2, 1,
  ];
}

/** column-major 4x4 乘法: out = a × b */
function mat4Mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function makeVP(pos: [number, number, number], yawDeg: number, fovYDeg = 90): number[] {
  return mat4Mul(perspective(fovYDeg, 1, 0.1, 1000), viewMatrix(pos, yawDeg));
}

// ── extractCameraPose ──────────────────────────────────────

describe('extractCameraPose — 相机位姿提取', () => {
  it('原点相机 (朝 -Z): 轴与中心正确', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0));
    expect(pose).not.toBeNull();
    const p = pose!;
    expect(p.center[0]).toBeCloseTo(0, 6);
    expect(p.center[1]).toBeCloseTo(0, 6);
    expect(p.center[2]).toBeCloseTo(0, 6);
    expect(p.xAxis[0]).toBeCloseTo(1, 6);
    expect(p.yAxis[1]).toBeCloseTo(1, 6);
    expect(p.zAxis[2]).toBeCloseTo(1, 6);
    // fov 90° → p1 = 1/tan(45°) = 1
    expect(p.p1).toBeCloseTo(1, 6);
  });

  it('平移相机: 中心 = 相机位置', () => {
    const pose = extractCameraPose(makeVP([10, 2, -3], 0));
    expect(pose!.center[0]).toBeCloseTo(10, 5);
    expect(pose!.center[1]).toBeCloseTo(2, 5);
    expect(pose!.center[2]).toBeCloseTo(-3, 5);
  });

  it('yaw=90°: 视线朝向 -X, zAxis=(1,0,0)', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 90));
    const p = pose!;
    expect(p.zAxis[0]).toBeCloseTo(1, 5);
    expect(p.zAxis[1]).toBeCloseTo(0, 5);
    expect(p.zAxis[2]).toBeCloseTo(0, 5);
  });

  it('非正方形纵横比: p0 = p1 / aspect', () => {
    const vp = mat4Mul(perspective(90, 2, 0.1, 1000), viewMatrix([0, 0, 0], 0));
    const pose = extractCameraPose(vp)!;
    expect(pose.p0).toBeCloseTo(pose.p1 / 2, 6);
  });

  it('退化矩阵返回 null', () => {
    expect(extractCameraPose(new Array(16).fill(0))).toBeNull();
  });
});

// ── worldToCameraCSS ───────────────────────────────────────

describe('worldToCameraCSS — 世界点 → CSS 相机空间', () => {
  it('正前方点: 深度为正, 居中', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const cs = worldToCameraCSS(pose, [0, 0, -5]);
    expect(cs.depth).toBeCloseTo(5, 6);
    expect(cs.x).toBeCloseTo(0, 6);
    expect(cs.y).toBeCloseTo(0, 6);
  });

  it('Y 翻转: 世界上方 → CSS y 为负', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const cs = worldToCameraCSS(pose, [0, 3, -5]);
    expect(cs.y).toBeCloseTo(-3, 6);
  });

  it('旋转相机后: 视线方向点深度为正', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 90))!;
    const cs = worldToCameraCSS(pose, [-5, 0, 0]);
    expect(cs.depth).toBeCloseTo(5, 5);
    expect(cs.x).toBeCloseTo(0, 5);
  });

  it('相机后方点: 深度为负', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const cs = worldToCameraCSS(pose, [0, 0, 5]);
    expect(cs.depth).toBeLessThan(0);
  });

  it('与 VP 矩阵直接投影一致 (屏幕像素)', () => {
    // fy·x/depth 应等于 ndcX × 视口半宽 (aspect=1)
    const viewH = 800;
    const vp = makeVP([1, -2, 3], 37);
    const pose = extractCameraPose(vp)!;
    const world: [number, number, number] = [2.5, 1.2, -6];

    // 直接 VP 投影
    const clipW = vp[3] * world[0] + vp[7] * world[1] + vp[11] * world[2] + vp[15];
    const clipX = vp[0] * world[0] + vp[4] * world[1] + vp[8] * world[2] + vp[12];
    const clipY = vp[1] * world[0] + vp[5] * world[1] + vp[9] * world[2] + vp[13];
    const screenPxX = (clipX / clipW) * (viewH / 2); // aspect=1 → 半宽=半高
    const screenPxY = (clipY / clipW) * (viewH / 2);

    // CSS 路径: fy·x/depth (y 轴方向: CSS 向下为正, NDC 向上为正 → 取反比较)
    const cs = worldToCameraCSS(pose, world);
    const fy = (pose.p1 * viewH) / 2;
    expect((fy * cs.x) / cs.depth).toBeCloseTo(screenPxX, 3);
    expect((fy * cs.y) / cs.depth).toBeCloseTo(-screenPxY, 3);
  });
});

// ── 平面轴向 ───────────────────────────────────────────────

describe('平面轴向 (billboard / fixed)', () => {
  it('billboard: 正前方平面, x=世界右, y=世界下', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const axes = billboardAxes(pose, [0, 0, -5]);
    expect(axes.x[0]).toBeCloseTo(1, 5);
    expect(axes.x[1]).toBeCloseTo(0, 5);
    expect(axes.y[0]).toBeCloseTo(0, 5);
    expect(axes.y[1]).toBeCloseTo(-1, 5); // 元素 +Y 向下 = 世界 -Y
  });

  it('billboard: 侧方平面仍面向相机 (右方向水平)', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const axes = billboardAxes(pose, [3, 0, -4]);
    // 右方向应保持水平 (y 分量≈0)
    expect(Math.abs(axes.x[1])).toBeLessThan(1e-6);
    // x 与 y 正交
    const dot = axes.x[0] * axes.y[0] + axes.x[1] * axes.y[1] + axes.x[2] * axes.y[2];
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('fixedAxes(0,0): 法线 +Z, 右 +X, 元素向下 -Y', () => {
    const axes = fixedAxes(0, 0);
    expect(axes.x[0]).toBeCloseTo(1, 6);
    expect(axes.y[1]).toBeCloseTo(-1, 6);
  });

  it('fixedAxes(90,0): 法线 +X, 轴仍正交归一', () => {
    const axes = fixedAxes(90, 0);
    const lenX = Math.hypot(...axes.x);
    const lenY = Math.hypot(...axes.y);
    expect(lenX).toBeCloseTo(1, 6);
    expect(lenY).toBeCloseTo(1, 6);
    const dot = axes.x[0] * axes.y[0] + axes.x[1] * axes.y[1] + axes.x[2] * axes.y[2];
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });
});

// ── buildWorldToCSSMatrix ──────────────────────────────────

describe('buildWorldToCSSMatrix — 世界 → CSS 矩阵', () => {
  const viewW = 1000;
  const viewH = 1000;
  // 相机在原点、朝 -Z, fov 90 → p1 = 1, fy = p1·viewH/2 = 500
  const fy = 500;

  it('原点相机 + 正前方锚点: 中心在屏幕中央, z = fy - 深度', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const axes = billboardAxes(pose, [0, 0, -5]);
    const m = buildWorldToCSSMatrix(pose, viewW, viewH, [0, 0, -5], axes, 100);

    // col3: (W/2 + 0, H/2 - 0, fy + zAxis·d, 1) = (500, 500, 500-5, 1)
    expect(m[12]).toBeCloseTo(viewW / 2, 6);
    expect(m[13]).toBeCloseTo(viewH / 2, 6);
    expect(m[14]).toBeCloseTo(fy - 5, 6); // z = fy - depth
    expect(m[15]).toBeCloseTo(1, 6);
    // col0 x 分量 = 1/pxPerUnit = 0.01 (billboard x 轴 = 相机右向)
    expect(m[0]).toBeCloseTo(0.01, 6);
  });

  it('侧向锚点: 屏幕偏移 = 横向偏移 × fy/深度 (透视正确)', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const anchor: [number, number, number] = [1, 0, -5];
    const axes = billboardAxes(pose, anchor);
    const m = buildWorldToCSSMatrix(pose, viewW, viewH, anchor, axes, 100);

    // 平面中心屏幕偏移 = (m[12] - W/2) × fy/(fy - m[14]) = 1 × 500/5 = 100px (向右)
    const depth = fy - m[14];
    const screenOffsetX = (m[12] - viewW / 2) * (fy / depth);
    const screenOffsetY = (m[13] - viewH / 2) * (fy / depth);
    expect(screenOffsetX).toBeCloseTo(100, 4);
    expect(screenOffsetY).toBeCloseTo(0, 4);
  });

  it('世界尺寸换算: 局部 (宽×pxPerUnit)px 按透视投影为世界宽', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const axes = billboardAxes(pose, [0, 0, -5]);
    const m = buildWorldToCSSMatrix(pose, viewW, viewH, [0, 0, -5], axes, 100);

    // 局部 100px (= 1 世界单位) 的屏幕宽度 = col0.x·100 × fy/depth = 0.01·100·500/5 = 100px
    const localPx = 100; // = 1 世界单位
    const depth = fy - m[14];
    const screenW = Math.hypot(m[0] * localPx, m[1] * localPx) * (fy / depth);
    expect(screenW).toBeCloseTo(100, 3);
  });

  it('toCSSMatrix3d 生成合法 matrix3d 字符串', () => {
    const pose = extractCameraPose(makeVP([0, 0, 0], 0))!;
    const axes = billboardAxes(pose, [0, 0, -5]);
    const m = buildWorldToCSSMatrix(pose, 800, 800, [0, 0, -5], axes);
    const css = toCSSMatrix3d(m);
    expect(css.startsWith('matrix3d(')).toBe(true);
    expect(css.split(',').length).toBe(16);
  });
});
