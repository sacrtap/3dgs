# @3dgs/convert

数据转换 CLI 工具。

## 安装

```bash
npm install -g @3dgs/convert
```

## 命令

### info — 查看文件信息

```bash
3dgs-convert info <file>
```

### ply-to-splat — PLY 转 SPLAT

```bash
3dgs-convert ply-to-splat <input.ply> --output <output.splat>
```

### ply-to-spz — PLY 转 SPZ

```bash
3dgs-convert ply-to-spz <input.ply> --output <output.spz> [--sh-degree 0|1|2|3]
```

### ply-to-sog — PLY 转 SOG

```bash
3dgs-convert ply-to-sog <input.ply> --output <output.sog> [--chunk-size 50000]
```

### batch — 批量转换

```bash
3dgs-convert batch <input-dir> --format splat|spz|sog [--output <dir>] [--sh-degree 1]
```

### generate-tour — 生成配置模板

```bash
3dgs-convert generate-tour <scenes-dir> --output tour.json
```

## 编程式使用

```typescript
import { convertPlyToSplat, convertPlyToSpz, convertPlyToSog } from '@3dgs/convert';

await convertPlyToSplat('input.ply', 'output.splat');
await convertPlyToSpz('input.ply', 'output.spz', { shDegree: 1 });
await convertPlyToSog('input.ply', 'output.sog', {
  chunkSize: 50000,
  compression: true,       // SOG v2: gzip 压缩 chunk (默认 true)
  buildLodTree: true,      // 预构建 LOD 树 (默认 true)
  positionQuant: false,   // 位置量化 (默认 false, 29 字节紧凑格式)
});
```

## SOG v2 格式

SOG v2 在 v1 基础上新增以下特性，向后兼容 v1：

| 特性 | 说明 |
|------|------|
| **gzip 压缩** | chunk 数据可选 gzip 压缩 (`compression: true`) |
| **LOD 树元数据** | 预构建 LOD 层级 (Morton 前缀子集), 离线生成 |
| **位置量化** | 29 字节紧凑格式 (Position 3×Uint24, 体积 -9%) |

### SOG v2 导出常量

| 常量 | 值 | 说明 |
|------|------|------|
| `SOG_MAGIC_V1` | `0x31474F53` | SOG v1 魔数 ("SOG1") |
| `SOG_MAGIC_V2` | `0x32474F53` | SOG v2 魔数 ("SOG2") |
| `SOG_VERSION_V1` | `1` | v1 版本号 |
| `SOG_VERSION_V2` | `2` | v2 版本号 |
| `SOG_COMPRESSION_NONE` | `0` | 无压缩 |
| `SOG_COMPRESSION_GZIP` | `1` | gzip 压缩 |
| `SOG_POSITION_QUANT_OFF` | `0` | 位置量化关闭 (32 字节/splat) |
| `SOG_POSITION_QUANT_24BIT` | `1` | 24-bit 量化 (29 字节/splat) |
| `SOG_COMPACT_BYTES_PER_SPLAT` | `29` | 紧凑格式每 splat 字节数 |
| `DEFAULT_LOD_LEVELS` | `4` | 默认 LOD 层级数 |
| `DEFAULT_LOD_BASE_QUALITY` | `1.75` | 质量 LOD 缩减因子 |
| `DEFAULT_LOD_BASE_FAST` | `1.5` | 快速 LOD 缩减因子 |
| `MIN_LOD_SPLATS` | `100` | 最粗 LOD 层级最少 splat 数 |
| `LOD_TREE_HEADER_SIZE` | `8` | LOD 树二进制头大小 |

### LOD 树 API

```typescript
import { buildLodLevels, serializeLodTree, deserializeLodTree } from '@3dgs/convert';

// 构建 LOD 层级 (基于 Morton 排序前缀子集)
const levels = buildLodLevels(1_000_000, 4, 1.75);
// [100, 175, 306, 1000000] (累计 splat 数)

// 序列化 LOD 树为二进制
const buffer = serializeLodTree(levels, 1.75);

// 反序列化
const { levels: restored, lodBase } = deserializeLodTree(buffer);
```
