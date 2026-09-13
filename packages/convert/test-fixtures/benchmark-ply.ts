/**
 * ★ C-09: 基准 PLY 生成器 (确定性, 内存字节, 不落盘)
 *
 * 生成小型标准 3DGS 二进制 PLY, 覆盖 SH degree 1/2/3,
 * 供跨格式 round-trip 质量回归套件 (round-trip.test.ts) 使用。
 *
 * 注意: `*.ply` 在仓库 gitignore 中, fixture 必须以生成器形式存在,
 * 测试运行时在内存中构造字节, 不提交二进制文件。
 */

/** 每顶点属性 (与 make3dgsPly 布局一致): xyz + scale×3 + rot×4 + opacity + f_dc×3 + f_rest×N */
export interface FixtureSplat {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotW: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  opacity: number;
  /** DC 系数 (3, 经 SH_C0×dc+0.5 → 颜色) */
  dc: number[];
  /** rest 系数 (shDim×3) */
  sh: number[];
}

export interface BenchmarkPly {
  /** 顶点数 */
  count: number;
  /** SH 阶数 */
  shDegree: 0 | 1 | 2 | 3;
  /** 完整 PLY 字节 (含 header) */
  bytes: ArrayBuffer;
}

/** 构造确定性基准 splat 集合 */
export function createBenchmarkSplats(count: number, shDegree: 0 | 1 | 2 | 3): FixtureSplat[] {
  const shDim = shDegree === 0 ? 0 : shDegree * (shDegree + 2);
  const splats: FixtureSplat[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    // 位置覆盖正负与边界
    const x = (t - 0.5) * 4 + Math.sin(t * Math.PI * 2) * 0.2;
    const y = (t - 0.3) * 3 + Math.cos(t * Math.PI * 3) * 0.1;
    const z = (t - 0.7) * 5 + Math.sin(t * Math.PI * 5) * 0.05;
    // 缩放跨数量级 (exp 后)
    const scaleX = Math.exp((Math.sin(t * 7) * 0.5 - 4) * 1.5);
    const scaleY = Math.exp((Math.cos(t * 5) * 0.3 - 3.5) * 1.5);
    const scaleZ = Math.exp((Math.sin(t * 11) * 0.7 - 4.5) * 1.5);
    // 单位四元数 (w 主导)
    const rotW = 0.9 + t * 0.09;
    const rotX = Math.sin(t * 3) * 0.1;
    const rotY = Math.cos(t * 2) * 0.08;
    const rotZ = Math.sin(t * 5) * 0.05;
    const rLen = Math.sqrt(rotW * rotW + rotX * rotX + rotY * rotY + rotZ * rotZ);
    // 颜色在 [0,1], 透明度在 (0,1)
    const opacity = 0.3 + ((i * 7919) % 700) / 1000; // 0.3 ~ 0.999
    // ★ DC 系数: 颜色 = SH_C0×dc + 0.5, dc 范围应使颜色在 [0,1] 附近
    const dc = [
      Math.sin(i * 0.9) * 0.8,
      Math.cos(i * 1.3) * 0.8,
      Math.sin(i * 0.4 + 1.3) * 0.8,
    ];
    // ★ sh 数组 = shDim×3 (rest 系数; DC 在 PLY 中走 f_dc 属性 → colors 通道)
    const sh: number[] = [];
    const shLen = shDim * 3;
    for (let j = 0; j < shLen; j++) {
      // 系数落在 [-1, 1] 内, 量化桶中心附近
      sh.push(Math.sin(i * 0.37 + j * 1.31) * 0.6);
    }
    splats.push({
      x,
      y,
      z,
      scaleX,
      scaleY,
      scaleZ,
      rotW: rotW / rLen,
      rotX: rotX / rLen,
      rotY: rotY / rLen,
      rotZ: rotZ / rLen,
      opacity,
      dc,
      sh,
    });
  }
  return splats;
}

/** 生成标准 3DGS 二进制 PLY 字节 */
export function generateBenchmarkPly(
  count: number,
  shDegree: 0 | 1 | 2 | 3,
): BenchmarkPly {
  const splats = createBenchmarkSplats(count, shDegree);
  const shDim = shDegree === 0 ? 0 : shDegree * (shDegree + 2);
  // ★ f_rest 数量 = shDim × 3 (rest 系数, DC 由 f_dc_0..2 单独存储; 与 convert 的 sh 数组长度一致)
  const restCount = shDim * 3;

  const props = [
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float f_rest_0',
  ];
  // 展开全部 f_rest
  for (let j = 0; j < restCount; j++) {
    if (j === 0) continue;
    props.push(`property float f_rest_${j}`);
  }
  props.push('property float opacity');
  props.push('property float scale_0', 'property float scale_1', 'property float scale_2');
  props.push('property float rot_0', 'property float rot_1', 'property float rot_2', 'property float rot_3');

  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.join(
    '\n',
  )}\nend_header\n`;
  const headerBytes = new TextEncoder().encode(header);

  // 每顶点 float 数: 3 pos + 3 normal + 3 dc + rest + 1 opacity + 3 scale + 4 rot
  const floatsPerVertex = 3 + 3 + 3 + restCount + 1 + 3 + 4;
  const body = new Float32Array(count * floatsPerVertex);

  for (let i = 0; i < count; i++) {
    const s = splats[i];
    const o = i * floatsPerVertex;
    body[o + 0] = s.x;
    body[o + 1] = s.y;
    body[o + 2] = s.z;
    body[o + 3] = 0; // nx
    body[o + 4] = 0;
    body[o + 5] = 0;
    // f_dc (SH DC 系数, 反算: color = SH_C0 * dc + 0.5)
    body[o + 6] = s.dc[0];
    body[o + 7] = s.dc[1];
    body[o + 8] = s.dc[2];
    // f_rest
    for (let j = 0; j < restCount; j++) {
      body[o + 9 + j] = s.sh ? s.sh[j] : 0;
    }
    // opacity (logit 空间? 我们直接用概率, 解析时 sigmoid 处理的快路径会差异)
    // ★ C-09: 基准文件用 logit 空间 opacity (与训练产物一致), 快路径 sigmoid 还原概率
    body[o + 9 + restCount] = Math.log(Math.max(s.opacity, 1e-3) / (1 - Math.min(s.opacity, 0.999)));
    // scale (log 空间)
    body[o + 9 + restCount + 1] = Math.log(s.scaleX);
    body[o + 9 + restCount + 2] = Math.log(s.scaleY);
    body[o + 9 + restCount + 3] = Math.log(s.scaleZ);
    // rot
    body[o + 9 + restCount + 4] = s.rotW;
    body[o + 9 + restCount + 5] = s.rotX;
    body[o + 9 + restCount + 6] = s.rotY;
    body[o + 9 + restCount + 7] = s.rotZ;
  }

  const buffer = new ArrayBuffer(headerBytes.length + body.byteLength);
  new Uint8Array(buffer).set(headerBytes, 0);
  new Uint8Array(buffer).set(new Uint8Array(body.buffer), headerBytes.length);
  return { count, shDegree, bytes: buffer };
}

/** 计算 SH 每通道系数数 (与 convert/渲染器一致) */
export function shDimForDegree(degree: 0 | 1 | 2 | 3): number {
  switch (degree) {
    case 1:
      return 3;
    case 2:
      return 8;
    case 3:
      return 15;
    default:
      return 0;
  }
}
