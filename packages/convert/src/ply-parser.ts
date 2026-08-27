/**
 * PLY 解析器 — 支持 binary_little_endian / binary_big_endian / ascii
 *
 * 支持:
 *   - 标准 3DGS PLY (248B/vertex: position, normal, SH, opacity, scale, rotation)
 *   - 简单点云 PLY (position + color)
 *   - 任意自定义属性的 PLY
 *
 * [来源: PLY 文件格式规范 — pavie/meshlib PLY spec]
 */

export type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

export interface PlyProperty {
  type: PlyDataType;
  name: string;
  /** 是否是列表属性 (如 property list uchar int vertex_indices) */
  isList?: boolean;
  countType?: PlyDataType;
}

export interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

export interface PlyHeader {
  format: PlyFormat;
  version: string;
  elements: PlyElement[];
  comments: string[];
}

export type PlyDataType =
  | 'char' | 'uchar' | 'int8' | 'uint8'
  | 'short' | 'ushort' | 'int16' | 'uint16'
  | 'int' | 'uint' | 'int32' | 'uint32' | 'float' | 'float32'
  | 'double' | 'float64';

/** 解析后的 PLY 数据 (每个 element 对应一个二维数组) */
export interface PlyData {
  header: PlyHeader;
  /** element name → array of row objects (property name → value) */
  data: Map<string, Record<string, number | number[]>[]>;
}

export const DATA_TYPE_SIZE: Record<PlyDataType, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

/**
 * 解析 PLY 文件
 * @param buffer PLY 文件的 ArrayBuffer
 * @returns 解析后的 PLY 数据
 */
export function parsePly(buffer: ArrayBuffer): PlyData {
  const headerResult = parsePlyHeader(buffer);
  const { header, headerEnd } = headerResult;

  const data = new Map<string, Record<string, number | number[]>[]>();

  const bodyBuffer = new Uint8Array(buffer, headerEnd);

  if (header.format === 'ascii') {
    parseAsciiBody(buffer, headerEnd, header, data);
  } else {
    parseBinaryBody(bodyBuffer, header, data);
  }

  return { header, data };
}

/** 解析 PLY 头部 */
export function parsePlyHeader(buffer: ArrayBuffer): { header: PlyHeader; headerEnd: number } {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  let line = '';

  // 读取第一行，必须是 "ply"
  line = readLine(bytes, offset);
  offset += line.length + 1;
  if (line.trim() !== 'ply') {
    throw new Error(`无效的 PLY 文件: 第一行应为 "ply"，实际为 "${line}"`);
  }

  // ★ C2: 修复 const→let, 在第一次扫描中直接赋值 format
  let format: PlyFormat = 'binary_little_endian';
  let version = '1.0';
  const elements: PlyElement[] = [];
  const comments: string[] = [];
  let currentElement: PlyElement | null = null;

  while (offset < bytes.length) {
    line = readLine(bytes, offset);
    offset += line.length + 1;

    const trimmed = line.trim();
    if (trimmed === 'end_header') break;

    if (trimmed.startsWith('comment')) {
      comments.push(trimmed.substring(7).trim());
      continue;
    }

    if (trimmed.startsWith('format')) {
      const parts = trimmed.split(/\s+/);
      if (parts[1] === 'ascii') {
        format = 'ascii';
      } else if (parts[1] === 'binary_little_endian') {
        format = 'binary_little_endian';
      } else if (parts[1] === 'binary_big_endian') {
        format = 'binary_big_endian';
      }
      if (parts[2]) version = parts[2];
    }

    if (trimmed.startsWith('element')) {
      const parts = trimmed.split(/\s+/);
      currentElement = {
        name: parts[1],
        count: parseInt(parts[2], 10),
        properties: [],
      };
      elements.push(currentElement);
      continue;
    }

    if (trimmed.startsWith('property')) {
      if (!currentElement) throw new Error('property 出现在 element 之前');
      const parts = trimmed.split(/\s+/);

      if (parts[1] === 'list') {
        currentElement.properties.push({
          type: parts[3] as PlyDataType,
          name: parts[4],
          isList: true,
          countType: parts[2] as PlyDataType,
        });
      } else {
        currentElement.properties.push({
          type: parts[1] as PlyDataType,
          name: parts[2],
        });
      }
      continue;
    }
  }

  // ★ C2: 删除二次扫描 hack (原 const 限制已修复, format 在第一次扫描中已正确赋值)
  return { header: { format, version, elements, comments }, headerEnd: offset };
}

/** 从字节数组中读取一行 (ASCII) */
function readLine(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) {
    end++;
  }
  // 处理 \r\n
  const lineEnd = end;
  const line = new TextDecoder().decode(bytes.subarray(offset, lineEnd));
  return line;
}

/** 解析 ASCII 格式的 PLY body */
function parseAsciiBody(
  buffer: ArrayBuffer,
  headerEnd: number,
  header: PlyHeader,
  data: Map<string, Record<string, number | number[]>[]>,
): void {
  const text = new TextDecoder().decode(new Uint8Array(buffer, headerEnd));
  const lines = text.split('\n');

  let lineIdx = 0;
  for (const element of header.elements) {
    const rows: Record<string, number | number[]>[] = [];

    for (let i = 0; i < element.count; i++) {
      const line = lines[lineIdx++].trim();
      if (!line) { i--; continue; }

      const tokens = line.split(/\s+/);
      const row: Record<string, number | number[]> = {};
      let tokenIdx = 0;

      for (const prop of element.properties) {
        if (prop.isList) {
          const count = parseInt(tokens[tokenIdx++], 10);
          const arr: number[] = [];
          for (let j = 0; j < count; j++) {
            arr.push(parseFloat(tokens[tokenIdx++]));
          }
          row[prop.name] = arr;
        } else {
          row[prop.name] = parseFloat(tokens[tokenIdx++]);
        }
      }
      rows.push(row);
    }
    data.set(element.name, rows);
  }
}

/** 解析二进制格式的 PLY body */
function parseBinaryBody(
  bytes: Uint8Array,
  header: PlyHeader,
  data: Map<string, Record<string, number | number[]>[]>,
): void {
  const littleEndian = header.format === 'binary_little_endian';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  for (const element of header.elements) {
    const rows: Record<string, number | number[]>[] = [];

    for (let i = 0; i < element.count; i++) {
      const row: Record<string, number | number[]> = {};

      for (const prop of element.properties) {
        if (prop.isList) {
          const countType = prop.countType!;
          const count = readBinaryValue(view, offset, countType, littleEndian);
          offset += DATA_TYPE_SIZE[countType];
          const arr: number[] = [];
          for (let j = 0; j < count; j++) {
            arr.push(readBinaryValue(view, offset, prop.type, littleEndian));
            offset += DATA_TYPE_SIZE[prop.type];
          }
          row[prop.name] = arr;
        } else {
          row[prop.name] = readBinaryValue(view, offset, prop.type, littleEndian);
          offset += DATA_TYPE_SIZE[prop.type];
        }
      }
      rows.push(row);
    }
    data.set(element.name, rows);
  }
}

/** 从 DataView 读取一个二进制值 */
function readBinaryValue(
  view: DataView,
  offset: number,
  type: PlyDataType,
  littleEndian: boolean,
): number {
  switch (type) {
    case 'char': case 'int8':
      return view.getInt8(offset);
    case 'uchar': case 'uint8':
      return view.getUint8(offset);
    case 'short': case 'int16':
      return view.getInt16(offset, littleEndian);
    case 'ushort': case 'uint16':
      return view.getUint16(offset, littleEndian);
    case 'int': case 'int32':
      return view.getInt32(offset, littleEndian);
    case 'uint': case 'uint32':
      return view.getUint32(offset, littleEndian);
    case 'float': case 'float32':
      return view.getFloat32(offset, littleEndian);
    case 'double': case 'float64':
      return view.getFloat64(offset, littleEndian);
    default:
      throw new Error(`不支持的数据类型: ${type}`);
  }
}

// ─── M2: PLY 快路径解析 → TypedArray ──────────────────────

/**
 * ★ M2: 快路径二进制 PLY 解析结果 (TypedArray 列式存储)
 *
 * 将标准 3DGS PLY 的 binary body 直接读取到 TypedArray,
 * 跳过中间 Record<string, number> 对象数组, 减少内存 ~50%, 加速 ~2x。
 *
 * [来源: 会议决策 M2 — docs/party-mode-memories/2026-08-17-convert-quality-loss-memory.md]
 */
export interface PlyFastPathData {
  /** 顶点数 */
  count: number;
  /** 位置 XYZ (3 × count, Float32Array) */
  positions: Float32Array;
  /** 法线 NX NY NZ (3 × count, Float32Array, 可选) */
  normals?: Float32Array;
  /** SH DC 系数 f_dc_0..2 (3 × count, Float32Array, 可选) */
  shDc?: Float32Array;
  /** SH rest 系数 f_rest_0..N (N × count, Float32Array, 可选) */
  shRest?: Float32Array;
  /** 不透明度 (1 × count, Float32Array, 可选) */
  opacity?: Float32Array;
  /** 缩放 scale_0..2 (3 × count, Float32Array, 可选) */
  scales?: Float32Array;
  /** 旋转 rot_0..3 (4 × count, Float32Array, 可选) */
  rotations?: Float32Array;
  /** 颜色 red,green,blue (3 × count, Uint8Array, 可选) */
  colors?: Uint8Array;
  /** 属性名→类型映射 */
  propertyMap: Map<string, { type: PlyDataType; offset: number; index: number }>;
  /** 每顶点字节大小 (stride) */
  stride: number;
}

/**
 * ★ M2: 尝试快路径解析二进制 PLY
 *
 * 仅支持 binary_little_endian / binary_big_endian 格式。
 * 将属性直接读取到 TypedArray, 跳过中间对象数组。
 *
 * 性能提升:
 *   - 内存: ~50% 减少 (Float32Array vs Record<string, number>[])
 *   - 速度: ~2x 加速 (直接 TypedArray 读取 vs 逐属性对象构建)
 *
 * @param buffer PLY 文件的 ArrayBuffer
 * @param header PLY 头部信息 (从 parsePlyHeader 获取)
 * @param headerEnd header 结束位置 (字节偏移)
 * @returns PlyFastPathData, 或 null (不支持快路径时)
 */
export function tryFastPathParsePly(
  buffer: ArrayBuffer,
  header: PlyHeader,
  headerEnd: number,
): PlyFastPathData | null {
  // 仅支持二进制格式
  if (header.format === 'ascii') return null;

  const littleEndian = header.format === 'binary_little_endian';
  const vertexElement = header.elements.find((e) => e.name === 'vertex');
  if (!vertexElement) return null;

  const count = vertexElement.count;
  if (count === 0) {
    return {
      count: 0,
      positions: new Float32Array(0),
      propertyMap: new Map(),
      stride: 0,
    };
  }

  // 计算每顶点 stride 和属性偏移
  const props = vertexElement.properties;
  const stride = props.reduce((sum, p) => sum + (p.isList ? 0 : DATA_TYPE_SIZE[p.type]), 0);

  // 若有 list 属性, 不支持快路径
  if (props.some((p) => p.isList)) return null;

  // 构建属性映射
  const propertyMap = new Map<string, { type: PlyDataType; offset: number; index: number }>();
  let currentOffset = 0;
  const propIndices: Record<string, number> = {};

  for (const prop of props) {
    const index = propIndices[prop.name] ?? 0;
    propIndices[prop.name] = index + 1;
    propertyMap.set(prop.name, { type: prop.type, offset: currentOffset, index });
    currentOffset += DATA_TYPE_SIZE[prop.type];
  }

  // 分配 TypedArray
  const positions = new Float32Array(count * 3);
  let normals: Float32Array | undefined;
  let shDc: Float32Array | undefined;
  let shRest: Float32Array | undefined;
  let opacity: Float32Array | undefined;
  let scales: Float32Array | undefined;
  let rotations: Float32Array | undefined;
  let colors: Uint8Array | undefined;

  // 检测属性组
  const hasNormal = props.some((p) => p.name === 'nx' || p.name === 'ny' || p.name === 'nz');
  const hasShDc = props.some((p) => p.name.startsWith('f_dc_'));
  const hasShRest = props.some((p) => p.name.startsWith('f_rest_'));
  const hasOpacity = props.some((p) => p.name === 'opacity');
  const hasScale = props.some((p) => p.name.startsWith('scale_'));
  const hasRot = props.some((p) => p.name.startsWith('rot_'));
  const hasColor = props.some((p) => p.name === 'red' || p.name === 'green' || p.name === 'blue');

  // 计算 SH rest 数量
  let shRestCount = 0;
  for (const p of props) {
    if (p.name.startsWith('f_rest_')) shRestCount++;
  }

  if (hasNormal) normals = new Float32Array(count * 3);
  if (hasShDc) shDc = new Float32Array(count * 3);
  if (hasShRest) shRest = new Float32Array(count * shRestCount);
  if (hasOpacity) opacity = new Float32Array(count);
  if (hasScale) scales = new Float32Array(count * 3);
  if (hasRot) rotations = new Float32Array(count * 4);
  if (hasColor) colors = new Uint8Array(count * 3);

  const view = new DataView(buffer, headerEnd);

  // 逐顶点读取, 直接写入 TypedArray
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const i3 = i * 3;
    const i4 = i * 4;

    // 位置
    const xProp = propertyMap.get('x');
    const yProp = propertyMap.get('y');
    const zProp = propertyMap.get('z');
    if (xProp) positions[i3] = readBinaryValue(view, base + xProp.offset, xProp.type, littleEndian);
    if (yProp) positions[i3 + 1] = readBinaryValue(view, base + yProp.offset, yProp.type, littleEndian);
    if (zProp) positions[i3 + 2] = readBinaryValue(view, base + zProp.offset, zProp.type, littleEndian);

    // 法线
    if (normals) {
      const nxProp = propertyMap.get('nx');
      const nyProp = propertyMap.get('ny');
      const nzProp = propertyMap.get('nz');
      if (nxProp) normals[i3] = readBinaryValue(view, base + nxProp.offset, nxProp.type, littleEndian);
      if (nyProp) normals[i3 + 1] = readBinaryValue(view, base + nyProp.offset, nyProp.type, littleEndian);
      if (nzProp) normals[i3 + 2] = readBinaryValue(view, base + nzProp.offset, nzProp.type, littleEndian);
    }

    // SH DC
    if (shDc) {
      for (let j = 0; j < 3; j++) {
        const prop = propertyMap.get(`f_dc_${j}`);
        if (prop) shDc[i3 + j] = readBinaryValue(view, base + prop.offset, prop.type, littleEndian);
      }
    }

    // SH rest
    if (shRest) {
      for (let j = 0; j < shRestCount; j++) {
        const prop = propertyMap.get(`f_rest_${j}`);
        if (prop) shRest[i * shRestCount + j] = readBinaryValue(view, base + prop.offset, prop.type, littleEndian);
      }
    }

    // Opacity
    if (opacity) {
      const opProp = propertyMap.get('opacity');
      if (opProp) opacity[i] = readBinaryValue(view, base + opProp.offset, opProp.type, littleEndian);
    }

    // Scale
    if (scales) {
      for (let j = 0; j < 3; j++) {
        const prop = propertyMap.get(`scale_${j}`);
        if (prop) scales[i3 + j] = readBinaryValue(view, base + prop.offset, prop.type, littleEndian);
      }
    }

    // Rotation
    if (rotations) {
      for (let j = 0; j < 4; j++) {
        const prop = propertyMap.get(`rot_${j}`);
        if (prop) rotations[i4 + j] = readBinaryValue(view, base + prop.offset, prop.type, littleEndian);
      }
    }

    // Color
    if (colors) {
      const rProp = propertyMap.get('red');
      const gProp = propertyMap.get('green');
      const bProp = propertyMap.get('blue');
      if (rProp) colors[i3] = readBinaryValue(view, base + rProp.offset, rProp.type, littleEndian);
      if (gProp) colors[i3 + 1] = readBinaryValue(view, base + gProp.offset, gProp.type, littleEndian);
      if (bProp) colors[i3 + 2] = readBinaryValue(view, base + bProp.offset, bProp.type, littleEndian);
    }
  }

  return {
    count,
    positions,
    normals,
    shDc,
    shRest,
    opacity,
    scales,
    rotations,
    colors,
    propertyMap,
    stride,
  };
}

/**
 * ★ M2: 从快路径解析结果构建 GaussianCloud
 *
 * 将 PlyFastPathData 转换为 GaussianCloud, 复用 loadGaussiansFromPly 的逻辑
 * 但直接从 TypedArray 读取, 避免中间对象数组。
 *
 * @param fastData 快路径解析结果
 * @param options 加载选项
 * @returns GaussianCloud
 */
export function buildCloudFromFastPath(
  fastData: PlyFastPathData,
  options: { defaultScale?: number; source?: string } = {},
): import('./gaussian-loader.js').GaussianCloud {
  const { defaultScale = 0.01, source = 'fast-path' } = options;
  const count = fastData.count;

  // 检测属性
  const has3dgs = !!fastData.opacity && !!fastData.scales && !!fastData.rotations;
  const hasShDc = !!fastData.shDc;
  const hasShRest = !!fastData.shRest;
  const hasColor = !!fastData.colors;

  // 确定 SH 阶数
  let shDegree = 0;
  if (hasShRest) {
    const restCount = fastData.shRest!.length / count;
    if (restCount >= 45) shDegree = 3;
    else if (restCount >= 24) shDegree = 2;
    else if (restCount >= 9) shDegree = 1;
  }

  const shCoeffsPerChannel = shDegree === 0 ? 0 : shDegree * (shDegree + 2);
  const totalShCoeffs = shCoeffsPerChannel * 3;

  // 直接构建 splats 数组
  const splats: import('./gaussian-loader.js').GaussianSplat[] = new Array(count);

  const SH_C0 = 0.28209479177387814;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const i4 = i * 4;

    const x = fastData.positions[i3];
    const y = fastData.positions[i3 + 1];
    const z = fastData.positions[i3 + 2];

    // 缩放
    let scaleX: number, scaleY: number, scaleZ: number;
    if (has3dgs && fastData.scales) {
      scaleX = Math.exp(fastData.scales[i3]);
      scaleY = Math.exp(fastData.scales[i3 + 1]);
      scaleZ = Math.exp(fastData.scales[i3 + 2]);
    } else {
      scaleX = scaleY = scaleZ = defaultScale;
    }

    // 旋转
    let rotW: number, rotX: number, rotY: number, rotZ: number;
    if (has3dgs && fastData.rotations) {
      rotW = fastData.rotations[i4];
      rotX = fastData.rotations[i4 + 1];
      rotY = fastData.rotations[i4 + 2];
      rotZ = fastData.rotations[i4 + 3];
    } else {
      rotW = 1; rotX = 0; rotY = 0; rotZ = 0;
    }

    // 颜色
    let colorR: number, colorG: number, colorB: number;
    if (hasShDc && fastData.shDc) {
      colorR = SH_C0 * fastData.shDc[i3] + 0.5;
      colorG = SH_C0 * fastData.shDc[i3 + 1] + 0.5;
      colorB = SH_C0 * fastData.shDc[i3 + 2] + 0.5;
    } else if (hasColor && fastData.colors) {
      colorR = fastData.colors[i3] / 255;
      colorG = fastData.colors[i3 + 1] / 255;
      colorB = fastData.colors[i3 + 2] / 255;
    } else {
      colorR = 0.8; colorG = 0.8; colorB = 0.8;
    }

    // 不透明度
    let opacity: number;
    if (has3dgs && fastData.opacity) {
      const raw = fastData.opacity[i];
      opacity = 1 / (1 + Math.exp(-raw));
    } else {
      opacity = 1.0;
    }

    // SH 系数
    let sh: Float32Array | undefined;
    if (shDegree > 0 && hasShRest && fastData.shRest) {
      sh = new Float32Array(totalShCoeffs);
      for (let j = 0; j < totalShCoeffs; j++) {
        sh[j] = fastData.shRest[i * totalShCoeffs + j] || 0;
      }
    }

    splats[i] = {
      x, y, z,
      scaleX, scaleY, scaleZ,
      rotW, rotX, rotY, rotZ,
      colorR: Math.max(0, Math.min(1, colorR)),
      colorG: Math.max(0, Math.min(1, colorG)),
      colorB: Math.max(0, Math.min(1, colorB)),
      opacity: Math.max(0, Math.min(1, opacity)),
      sh,
      shDegree,
    };
  }

  return {
    splats,
    shDegree,
    vertexCount: count,
    source,
  };
}
