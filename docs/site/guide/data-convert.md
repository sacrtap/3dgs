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
| `.sog` | 空间排序分块格式 | 流式 LOD, 渐进加载 |

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

| 格式 | 72K splats 体积 | 压缩比 | 流式加载 |
|------|----------------|--------|---------|
| PLY | 2.3 MB | 1x | ✗ |
| SPLAT | 2.2 MB | 1.05x | ✗ |
| SPZ (SH0) | 0.58 MB | 3.85x | ✗ |
| SOG | 2.2 MB | 1.05x | ✓ |
