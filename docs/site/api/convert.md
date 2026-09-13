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
3dgs-convert ply-to-sog <input.ply> --output <output.sog> [--chunk-size 50000] [--sog-version 2|3]
```

> `--sog-version 3` 追加尾部 SH overlay（完整 SH 0-3 阶）；默认 v2。

### to-compressed-ply — 压缩 PLY（SuperSplat 兼容）

```bash
3dgs-convert to-compressed-ply <input.ply|.splat|.spz|.sog> --output <output.compressed.ply>
```

> 任意受支持输入均可转换；输出为 SuperSplat 兼容的量化压缩 PLY。

### batch — 批量转换

```bash
3dgs-convert batch <input-dir> --format splat|spz|sog [--output <dir>] [--sh-degree 1]
```

> 输入目录中的 `.ply / .splat / .spz / .sog` 全部支持；输出 `manifest.json`（含逐文件 input/output/count/format/elapsedMs）。

### generate-tour — 生成配置模板

```bash
3dgs-convert generate-tour <scenes-dir> --output tour.json
```

## 编程式使用

```typescript
import {
  loadGaussiansFromPly,
  writeSplat,
  writeSpz,
  writeSog,
} from '@3dgs/convert';

const cloud = loadGaussiansFromPly(await readFile('input.ply'));

// 写 .splat
writeSplat(cloud);

// 写 .spz (v2, gzip + 位置量化)
writeSpz(cloud, { shDegree: 1, fractionalBits: 12 });

// 写 .sog (v2 流式 LOD; version: 3 追加 SH overlay)
writeSog(cloud, {
  chunkSize: 8192,
  compression: true,          // SOG v2: gzip 压缩 chunk (默认 true)
  buildLodTree: true,         // 预构建 LOD 树 (默认 true)
  positionQuantization: false, // 位置量化 (默认 false, 29 字节紧凑格式)
  version: 2,                 // 2 或 3; 3 = 尾部 SH overlay
});

// SoA 快路径 (大文件内存优化)
import { loadGaussiansFromPlySoA, writeSogSoA } from '@3dgs/convert';
const soa = loadGaussiansFromPlySoA(buffer);
writeSogSoA(soa, { chunkSize: 8192 });
```

> 完整导出清单见 `packages/convert/src/index.ts`（含 `loadGaussiansFromSpz`（SPZ v1–v4 读取）、
> `readShOverlaySoA`、`writeCompressedPly`、`quickselect` / `quickselectIndices`、
> `mortonSortSoA` 等）。CLI 命令的等价封装位于 `packages/convert/src/cli.ts`（`convertPly` /
> `convertSplat` / `batchConvert` 为 CLI 内部函数，未导出为公共 API）。

> CLI 与底层 API 另有 `--max-splats`（转换期按贡献度预裁剪）与 `--contribution-cutoff`
> （quickselect O(N) 实现）；SoA 快路径见 `loadGaussiansFromPlySoA` / `toSoA` / `fromSoA`。

## SOG v3 格式

SOG v3 在 v2 布局之上追加**尾部 SH overlay**（数据区 + 12 字节头：overlayOffset u32 /
overlaySize u32 / shDegree u8 / shMode u8 / 2B 保留），完整保留 SH 0-3 阶系数：

| 特性 | 说明 |
|------|------|
| **SH overlay** | 文件尾部追加量化 SH 系数（`round(v×128)+128` 反量化 `(v-128)/128`） |
| **读取** | renderer `SogStreamer` 经两次 HTTP Range 请求加载（头 + 数据区） |
| **写入** | `writeSog({ version: 3 })` 或 CLI `--sog-version 3` |
| **兼容** | 布局 = v2 + 尾部追加，读取端按 magic `SOG_MAGIC_V3` 识别 |

### SOG 导出常量（v2/v3）

| 常量 | 值 | 说明 |
|------|------|------|
| `SOG_MAGIC_V1` | `0x31474F53` | SOG v1 魔数 ("SOG1") |
| `SOG_MAGIC_V2` | `0x32474F53` | SOG v2 魔数 ("SOG2") |
| `SOG_MAGIC_V3` | `0x33474F53` | SOG v3 魔数 ("SOG3") |
| `SOG_VERSION_V1/V2/V3` | `1/2/3` | 版本号 |
| `SOG_V3_OVERLAY_HEADER_SIZE` | `12` | v3 SH overlay 头大小 |
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
