# 数据转换

`@3dgs/convert` 提供 CLI 工具将 PLY 格式转换为 3DGS Web 渲染所需的格式。

## 安装

```bash
# 全局安装
npm install -g @3dgs/convert

# 或使用 npx
npx @3dgs/convert --help
```

## 支持的格式

| 格式 | 说明 | 特点 |
|------|------|------|
| `.splat` | 32 字节/splat 扁平格式 | 兼容性最好, 无压缩 |
| `.spz` | Niantic SPZ v2 格式 | gzip 压缩, 体积小 |
| `.sog` | 空间排序分块格式 (v2 支持 gzip 压缩 + LOD 树 + 位置量化) | 流式 LOD, 渐进加载 |

## 命令

### ply-to-splat

```bash
3dgs-convert ply-to-splat input.ply --output output.splat
```

### ply-to-spz

```bash
3dgs-convert ply-to-spz input.ply --output output.spz --sh-degree 1
```

### ply-to-sog

```bash
3dgs-convert ply-to-sog input.ply --output output.sog --chunk-size 50000
```

### 批量转换

```bash
3dgs-convert batch ./scenes/ --format spz --sh-degree 1 --output ./dist/
```

### 生成配置模板

```bash
3dgs-convert generate-tour ./scenes/ --output tour.json
```

### 查看文件信息

```bash
3dgs-convert info input.ply
```

## 格式对比

| 格式 | 72K splats 体积 | 压缩比 | 流式加载 | SH 支持 |
|------|----------------|--------|---------|--------|
| PLY | 2.3 MB | 1x | ✗ | ✓ |
| SPLAT | 2.2 MB | 1.05x | ✗ | ✗ |
| SPZ (SH0) | 0.58 MB | 3.85x | ✗ | ✓ (0-3) |
| SOG v1 | 2.2 MB | 1.05x | ✓ | ✗ |
| SOG v2 (gzip) | ~1.5 MB | ~1.5x | ✓ | ✗ |
| SOG v2 (gzip + 量化) | ~1.4 MB | ~1.65x | ✓ | ✗ |

## 格式选择指南

三种格式的**稳态渲染 FPS 基本一致**（差异 < 5%），格式选择主要影响加载体验和 LOD 质量。

### 按使用场景推荐

| 使用场景 | 推荐格式 | 原因 |
|---------|---------|------|
| 桌面端 / 高带宽 | `.splat` | 无解码开销，加载最简单 |
| 移动端 / 4G 网络 | `.spz` | 传输量减半，加载更快 |
| 大场景 (> 1M splats) | `.sog` | 首帧快速渲染 + LOD 效率高 |
| 需要球谐光照 | `.spz` | 唯一支持 SH 的格式 |
| 漫游多场景 | `.sog` | Morton 排序提升 LOD 质量 |

### 按设备分级推荐

| 设备分级 | 推荐格式 | 原因 |
|---------|---------|------|
| LOW (250K max) | `.spz` | 传输量小 + maxSplats 裁剪后数据量可控 |
| MEDIUM (500K max) | `.spz` / `.sog` | 平衡传输和加载体验 |
| HIGH (1M max) | `.sog` | LOD 效率高，渲染更流畅 |
| ULTRA (2.5M max) | `.splat` / `.sog` | 无传输瓶颈，LOD 提升渲染质量 |

### 格式特性详解

| 特性 | .splat | .spz | .sog v1 | .sog v2 |
|------|--------|------|---------|---------|
| 每 splat 字节 | 32 B | ~16 B (压缩前) | 32 B | 32 B 或 29 B (量化) |
| 压缩 | 无 | gzip + 量化 | 无 (分块传输) | gzip (可选) + 量化 (可选) |
| 位置精度 | Float32 | 24bit 定点 | Float32 | Float32 或 24bit 定点 |
| Morton 排序 | ✗ | ✗ | ✓ | ✓ |
| 预构建 LOD | ✗ | ✗ | ✗ | ✓ (LOD 树元数据) |
| 首帧时间 | 全量加载后 | 全量加载后 | 首块即渲染 | 首块即渲染 |
| LOD 友好度 | 低 | 低 | 高 | 高 |

> 详见 [渲染性能深度分析](https://github.com/sacrtap/3dgs/blob/main/docs/06-渲染性能深度分析与优化方案.md)。
