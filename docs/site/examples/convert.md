# 数据转换

使用 `@3dgs/convert` CLI 工具转换 3DGS 数据。

## 单文件转换

```bash
# PLY → SPLAT
3dgs-convert ply-to-splat input.ply --output output.splat

# PLY → SPZ (gzip 压缩)
3dgs-convert ply-to-spz input.ply --output output.spz --sh-degree 1

# PLY → SOG (流式 LOD)
3dgs-convert ply-to-sog input.ply --output output.sog --chunk-size 50000
```

## 批量转换

```bash
# 批量转换为 SPZ
3dgs-convert batch ./scenes/ --format spz --sh-degree 1 --output ./dist/

# 批量转换为 SOG (带 LOD)
3dgs-convert batch ./scenes/ --format sog --output ./dist/
```

## 生成配置模板

```bash
3dgs-convert generate-tour ./scenes/ --output tour.json
```

生成的 `tour.json` 会自动包含：
- 场景列表 (从目录中的 .splat/.spz 文件)
- 热点跳转链接 (自动连接相邻场景)
- 默认相机和过渡配置
- 元数据信息

## 编程式使用

```typescript
import {
  convertPlyToSplat,
  convertPlyToSpz,
  convertPlyToSog,
  generateTourConfig,
} from '@3dgs/convert';

// 单文件转换
await convertPlyToSplat('input.ply', 'output.splat');
await convertPlyToSpz('input.ply', 'output.spz', { shDegree: 1 });
await convertPlyToSog('input.ply', 'output.sog', { chunkSize: 50000 });

// 生成配置
await generateTourConfig('./scenes/', 'tour.json');
```

## 查看文件信息

```bash
3dgs-convert info input.ply

# 输出示例:
# PLY 文件信息:
#   Splats: 72,105
#   SH Degree: 0
#   Position: float32
#   Bounds: [-2.1, -1.5, -2.8] → [2.3, 1.8, 3.1]
```
