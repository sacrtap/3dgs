# @3dgs/convert

3DGS 数据转换 CLI — PLY → SPLAT / SPZ / SOG 格式转换 + tour.json 模板生成。

## 安装

```bash
npm install @3dgs/convert
# 或全局安装 CLI
npm install -g @3dgs/convert
```

## 用法

### CLI

```bash
# PLY → SPLAT
npx 3dgs-convert ply-to-splat input.ply --output output.splat

# PLY → SPZ (含球谐系数)
npx 3dgs-convert ply-to-spz input.ply --output output.spz --sh-degree 1

# PLY → SOG (流式 LOD)
npx 3dgs-convert ply-to-sog input.ply --output output.sog

# 批量转换
npx 3dgs-convert batch ./scenes/ --format spz --sh-degree 1

# 生成导览模板
npx 3dgs-convert generate-tour ./scenes/ --output tour.json
```

### 编程 API

```typescript
import { loadGaussiansFromPly, writeSplat, writeSpz, writeSog } from '@3dgs/convert';

const cloud = loadGaussiansFromPly(plyBuffer);
const splatBuffer = writeSplat(cloud);
```

## 支持的格式

| 格式 | 说明 | 压缩 | SH 支持 |
|------|------|------|---------|
| `.splat` | antimatter15 格式 | 无 | ❌ |
| `.spz` | Niantic 压缩格式 | ✅ 高 | ✅ |
| `.sog` | PlayCanvas 流式 LOD | ✅ 高 | ✅ |

## 许可证

[MIT](./LICENSE)
