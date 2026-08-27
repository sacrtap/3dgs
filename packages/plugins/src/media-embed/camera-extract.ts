/**
 * 相机外参提取 — 从 VP 矩阵闭式解出相机位姿与焦距
 *
 * 用于空间媒体嵌入 (media-embed): 把世界坐标的图像/视频平面
 * 通过 CSS 3D 透视叠加层无缝渲染到 3DGS 场景中。
 *
 * 推导 (three.js 约定, VP 为 column-major, VP = P × V, V = [Rcᵀ | -Rcᵀc]):
 *   设相机各轴 (世界系单位向量) 为 xAxis / yAxis / zAxis (Rc 的列):
 *     VP 行 0: (vp[0], vp[4], vp[8])  = P[0][0] · xAxis  → xAxis = 行0/‖行0‖, 记 p0 = ‖行0‖
 *     VP 行 1: (vp[1], vp[5], vp[9])  = P[1][1] · yAxis  → yAxis = 行1/‖行1‖, 记 p1 = ‖行1‖ (NDC 焦距)
 *     VP 行 3: (vp[3], vp[7], vp[11]) = -zAxis          → zAxis = -行3 (P[3][2] = -1)
 *   (注: VP 行 2 = P[2][2]·zAxis 含负缩放因子, 不能直接用)
 *   相机中心: 由三个正交投影分量重构:
 *     xAxis·c = -vp[12]/p0,  yAxis·c = -vp[13]/p1,  zAxis·c = vp[15]
 *     c = (xAxis·c)·xAxis + (yAxis·c)·yAxis + (zAxis·c)·zAxis
 *
 * CSS 相机空间约定: X 右 / Y **下** / Z 远离观察者 (深度为正):
 *   cssX = dot(xAxis, p - c)
 *   cssY = -dot(yAxis, p - c)
 *   depth = -dot(zAxis, p - c)   (> 0 表示在相机前方)
 */

/** 相机位姿 (世界系) + 投影焦距 */
export interface CameraPose {
  /** 相机 +X 轴 (世界系, 单位向量) */
  xAxis: [number, number, number];
  /** 相机 +Y 轴 (世界系, 单位向量) */
  yAxis: [number, number, number];
  /** 相机 +Z 轴 (世界系, 单位向量; 视线 = -zAxis) */
  zAxis: [number, number, number];
  /** 相机中心 (世界坐标) */
  center: [number, number, number];
  /** NDC 焦距 X (= 2·fx_px / 渲染宽) */
  p0: number;
  /** NDC 焦距 Y (= 2·fy_px / 渲染高) — CSS perspective 即 p1 × 容器高 / 2 */
  p1: number;
}

/** 世界点 → CSS 相机空间坐标 (X 右 / Y 下 / Z 深度为正) */
export interface CameraSpacePoint {
  x: number;
  y: number;
  /** 深度 (相机前方为正; ≤0 表示在相机后方) */
  depth: number;
}

const EPS = 1e-8;

/**
 * 从 16 元素 (column-major) VP 矩阵提取相机位姿。
 *
 * @returns 位姿; 矩阵退化 (焦距≈0) 时返回 null
 */
export function extractCameraPose(vp: ArrayLike<number>): CameraPose | null {
  const r0 = [vp[0], vp[4], vp[8]];
  const r1 = [vp[1], vp[5], vp[9]];

  const p0 = Math.hypot(r0[0], r0[1], r0[2]);
  const p1 = Math.hypot(r1[0], r1[1], r1[2]);
  if (p0 < EPS || p1 < EPS) return null;

  const xAxis: [number, number, number] = [r0[0] / p0, r0[1] / p0, r0[2] / p0];
  const yAxis: [number, number, number] = [r1[0] / p1, r1[1] / p1, r1[2] / p1];
  // zAxis = -VP 行3 (P[3][2] = -1, 行3 直接给出 -zAxis, 无缩放)
  const zAxis: [number, number, number] = [-vp[3], -vp[7], -vp[11]];
  const zLen = Math.hypot(zAxis[0], zAxis[1], zAxis[2]);
  if (zLen < EPS) return null;
  zAxis[0] /= zLen; zAxis[1] /= zLen; zAxis[2] /= zLen;

  // 相机中心: 三个正交投影分量重构 (见文件头推导)
  const cx = -vp[12] / p0;   // xAxis · c
  const cy = -vp[13] / p1;   // yAxis · c
  const cz = vp[15];         // zAxis · c
  const center: [number, number, number] = [
    cx * xAxis[0] + cy * yAxis[0] + cz * zAxis[0],
    cx * xAxis[1] + cy * yAxis[1] + cz * zAxis[1],
    cx * xAxis[2] + cy * yAxis[2] + cz * zAxis[2],
  ];

  return { xAxis, yAxis, zAxis, center, p0, p1 };
}

/**
 * 世界点 → CSS 相机空间 (X 右 / Y 下 / Z 深度为正)
 */
export function worldToCameraCSS(pose: CameraPose, p: [number, number, number]): CameraSpacePoint {
  const dx = p[0] - pose.center[0];
  const dy = p[1] - pose.center[1];
  const dz = p[2] - pose.center[2];

  const qx = pose.xAxis[0] * dx + pose.xAxis[1] * dy + pose.xAxis[2] * dz;
  const qy = pose.yAxis[0] * dx + pose.yAxis[1] * dy + pose.yAxis[2] * dz;
  const qz = pose.zAxis[0] * dx + pose.zAxis[1] * dy + pose.zAxis[2] * dz;

  return { x: qx, y: -qy, depth: -qz };
}

/** 平面局部轴 (世界系单位向量): x = 元素宽度方向, y = 元素高度(向下)方向 */
export interface PlaneAxes {
  x: [number, number, number];
  y: [number, number, number];
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * 公告板模式平面轴: 法线始终朝向相机 (水平方向对齐),
 * 适合悬浮信息屏/相框等始终面向观众的内容。
 */
export function billboardAxes(pose: CameraPose, anchor: [number, number, number]): PlaneAxes {
  // n = 平面指向相机的方向 (与固定朝向法线同语义)
  const n = normalize([
    pose.center[0] - anchor[0],
    pose.center[1] - anchor[1],
    pose.center[2] - anchor[2],
  ]);
  // right = up × n (观众视角的右方); 退化时 (法线近似竖直) 用相机 X 轴兜底
  let right = cross([0, 1, 0], n);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) {
    right = [...pose.xAxis] as [number, number, number];
  }
  const x = normalize(right);
  const planeUp = normalize(cross(n, x));
  // 元素 +Y 向下 = -planeUp (保证画面不上下颠倒)
  return { x, y: [-planeUp[0], -planeUp[1], -planeUp[2]] };
}

/**
 * 世界固定朝向平面轴 (如墙面挂画): 法线由 yaw (绕世界 Y, 度) 与 pitch (俯仰, 度) 确定。
 * yaw=0/pitch=0 时法线为 +Z。
 */
export function fixedAxes(yawDeg: number, pitchDeg = 0): PlaneAxes {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const n: [number, number, number] = [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ];
  let right = cross([0, 1, 0], n);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) {
    right = [1, 0, 0];
  }
  const x = normalize(right);
  const planeUp = normalize(cross(n, x));
  return { x, y: [-planeUp[0], -planeUp[1], -planeUp[2]] };
}

/**
 * 构建"世界 → CSS 透视叠加层"的 matrix3d (column-major, 16 元素)。
 *
 * 叠加层空间 = 相机空间 × 焦距 (X 右 / Y 下 / Z 深度, 透视除法由 CSS `perspective` 完成),
 * 矩阵把元素局部像素映射到该空间:
 *   - 列 0/1: 局部 X/Y 轴 (世界方向经相机变换 × 焦距 / pxPerUnit)
 *   - 列 3: 锚点在叠加层空间的坐标 (焦距 × 相机空间坐标)
 *
 * 元素尺寸取 (世界宽 × pxPerUnit) px 时, 渲染尺寸即等于世界尺寸。
 *
 * @param pose 相机位姿
 * @param viewWidth / viewHeight CSS 容器尺寸 (px)
 * @param anchor 平面中心的世界坐标
 * @param axes 平面局部轴 (世界系, 见 billboardAxes / fixedAxes)
 * @param pxPerUnit 每世界单位的局部像素数 (默认 100)
 */
export function buildWorldToCSSMatrix(
  pose: CameraPose,
  viewWidth: number,
  viewHeight: number,
  anchor: [number, number, number],
  axes: PlaneAxes,
  pxPerUnit = 100,
): number[] {
  const fy = (pose.p1 * viewHeight) / 2; // CSS perspective (px)
  const k = 1 / pxPerUnit;

  const dot = (a: [number, number, number], b: [number, number, number]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // 锚点相对相机的偏移 (世界系)
  const d: [number, number, number] = [
    anchor[0] - pose.center[0],
    anchor[1] - pose.center[1],
    anchor[2] - pose.center[2],
  ];

  // 列 0/1: 局部轴 → 叠加层 (x/y 为世界横向偏移, z 贡献深度; 均不含焦距, 透视除法由 CSS 完成)
  const col0 = [
    k * dot(pose.xAxis, axes.x),
    -k * dot(pose.yAxis, axes.x),
    k * dot(pose.zAxis, axes.x),
    0,
  ];
  const col1 = [
    k * dot(pose.xAxis, axes.y),
    -k * dot(pose.yAxis, axes.y),
    k * dot(pose.zAxis, axes.y),
    0,
  ];
  // 列 3: 锚点映射 (平移) — 叠加层坐标 = 屏幕中心 + 横向偏移, z = f - depth
  const col3 = [
    viewWidth / 2 + dot(pose.xAxis, d),
    viewHeight / 2 - dot(pose.yAxis, d),
    fy + dot(pose.zAxis, d),
    1,
  ];

  // column-major: [col0, col1, col2(未使用), col3]
  return [...col0, ...col1, 0, 0, 0, 0, ...col3];
}

/** 将 16 元素矩阵转为 CSS matrix3d() 字符串 */
export function toCSSMatrix3d(m: ArrayLike<number>): string {
  return `matrix3d(${Array.from(m, (v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')})`;
}
