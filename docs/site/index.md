# 3DGS Web Engine

轻量级 Web 3DGS (3D Gaussian Splatting) 渲染引擎与漫游框架。

## 特性

- **高性能渲染** — 基于 Spark + Three.js 的 WebGL2 渲染，支持 WebGPU 自动检测
- **声明式配置** — JSON 配置驱动的多场景漫游，零代码即可部署
- **插件生态** — 热点系统、场景过渡、深度遮挡、触摸手势、Shader 注入等
- **框架无关** — 核心零依赖，提供 React / Vue 适配层
- **数据工具链** — PLY → SPLAT / SPZ / SOG 格式转换 CLI
- **流式 LOD** — SOG 格式渐进式加载，首帧快速渲染
- **移动端适配** — 设备分级、自适应分辨率、多指触摸手势
- **TypeScript** — 完整类型定义，严格模式开发

## 快速开始

### 安装

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins
```

### 3 行代码嵌入 3DGS 场景

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';

const player = new TourPlayer(document.getElementById('viewer'));
player.setRenderer(createRendererSync());
await player.load(config);
await player.switchScene('first-scene');
```

### 包结构

| 包 | 说明 |
|---|---|
| `@3dgs/core` | 核心框架 — TourPlayer, SceneManager, PluginSystem |
| `@3dgs/renderer-three` | Three.js + Spark 渲染器 |
| `@3dgs/plugins` | 官方插件 (热点, 过渡, 触摸, Shader 等) |
| `@3dgs/convert` | 数据转换 CLI (PLY → SPLAT/SPZ/SOG) |
| `@3dgs/react` | React 适配层 |
| `@3dgs/vue` | Vue 适配层 |

## 链接

- [GitHub](https://github.com/sacrtap/3dgs)
- [快速开始](/guide/getting-started)
- [API 参考](/api/core)
- [示例](/examples/basic)
