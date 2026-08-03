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
await convertPlyToSog('input.ply', 'output.sog', { chunkSize: 50000 });
```
