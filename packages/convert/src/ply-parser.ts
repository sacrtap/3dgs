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
  data: Map<string, Record<string, number | number[]>>;
}

const DATA_TYPE_SIZE: Record<PlyDataType, number> = {
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

  const data = new Map<string, Record<string, number | number[]>>();

  const bodyBuffer = new Uint8Array(buffer, headerEnd);

  if (header.format === 'ascii') {
    parseAsciiBody(buffer, headerEnd, header, data);
  } else {
    parseBinaryBody(bodyBuffer, header, data);
  }

  return { header, data };
}

/** 解析 PLY 头部 */
function parsePlyHeader(buffer: ArrayBuffer): { header: PlyHeader; headerEnd: number } {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  let line = '';

  // 读取第一行，必须是 "ply"
  line = readLine(bytes, offset);
  offset += line.length + 1;
  if (line.trim() !== 'ply') {
    throw new Error(`无效的 PLY 文件: 第一行应为 "ply"，实际为 "${line}"`);
  }

  const format: PlyFormat = 'binary_little_endian';
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
        // format 已设为 ascii
      } else if (parts[1] === 'binary_little_endian') {
        // 默认值
      } else if (parts[1] === 'binary_big_endian') {
        // 覆盖为 big endian
      }
      // 不能直接覆盖 const，重写
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

  // 重新解析 format (上面被 const 限制)
  // 重新扫描 format 行
  let offset2 = 0;
  while (offset2 < bytes.length) {
    const l = readLine(bytes, offset2);
    offset2 += l.length + 1;
    const t = l.trim();
    if (t === 'end_header') break;
    if (t.startsWith('format')) {
      const parts = t.split(/\s+/);
      if (parts[1] === 'ascii') {
        return { header: { format: 'ascii', version: parts[2] || '1.0', elements, comments }, headerEnd: offset };
      } else if (parts[1] === 'binary_big_endian') {
        return { header: { format: 'binary_big_endian', version: parts[2] || '1.0', elements, comments }, headerEnd: offset };
      }
      return { header: { format: 'binary_little_endian', version: parts[2] || '1.0', elements, comments }, headerEnd: offset };
    }
  }

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
  data: Map<string, Record<string, number | number[]>>,
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
    data.set(element.name, rows as any);
  }
}

/** 解析二进制格式的 PLY body */
function parseBinaryBody(
  bytes: Uint8Array,
  header: PlyHeader,
  data: Map<string, Record<string, number | number[]>>,
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
    data.set(element.name, rows as any);
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
