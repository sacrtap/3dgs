# 示例代码库

本目录包含 3DGS Web Engine 的可运行示例代码。

## 示例列表

| # | 文件 | 说明 |
|---|------|------|
| 01 | `01-basic-embed.ts` | 基础嵌入 — createRenderer 自动检测 WebGPU |
| 02 | `02-multi-scene.ts` | 多场景漫游 — 场景跳转 + 热点导航 |
| 03 | `03-react-integration.tsx` | React 集成 — TourViewer 组件 |
| 04 | `04-vue-integration.ts` | Vue 集成 — TourViewer 组件 |
| 05 | `05-custom-hotspot.ts` | 自定义热点 — 样式 + 深度遮挡 |
| 06 | `06-shader-effects.ts` | Shader 效果 — 色调调整 + 动画 |
| 07 | `07-data-convert.ts` | 数据转换 — PLY → SPLAT/SPZ/SOG v2 |
| 08 | `08-mobile-optimization.ts` | 移动端优化 — 设备分级 + 触摸手势 + 质量参数 |
| 09 | `09-performance-monitor.ts` | 性能监控 — FPS + 后端 + 视锥裁剪统计 |
| 10 | `10-webgpu-backend.ts` | WebGPU 后端 — 自动检测 + GPU 类型 + 纹理压缩 |
| 11 | `11-sog-streaming.ts` | SOG 流式加载 — 分块渐进 + onFirstFrame + LOD 树 |
| 12 | `12-performance-tuning.ts` | 性能调优 — blurAmount/minAlpha/排序节流/视锥裁剪 |
| 13 | `13-spatial-extensions.ts` | 空间扩展 — 热点弹出面板 + 图像/视频嵌入 + Shader 预设 |

## 运行方式

1. 克隆仓库并安装依赖：
   ```bash
   git clone https://github.com/sacrtap/3dgs.git
   cd 3dgs
   pnpm install
   pnpm build
   ```

2. 启动 Demo 应用：
   ```bash
   pnpm --filter @3dgs/demo dev
   ```

3. 在 Demo 应用中查看各功能的实际效果。

## 文档站示例

更详细的示例文档请访问 [文档站示例页面](https://github.com/sacrtap/3dgs/tree/main/docs/site/examples)。
