# 快速开始

## 环境要求

- Node.js >= 18
- pnpm >= 9 (用于 monorepo 开发)
- 支持 WebGL2 的浏览器

## 安装

### 方式一：单包安装

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins three @sparkjsdev/spark
```

### 方式二：使用框架适配层

```bash
# React
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins @3dgs/react react react-dom

# Vue
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins @3dgs/vue vue
```

## 基础使用

### 1. 创建 HTML 容器

```html
<div id="viewer" style="width: 100%; height: 100vh;"></div>
```

### 2. 初始化播放器

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import { createHotspotSystem, createFullscreenPlugin } from '@3dgs/plugins';

// 创建播放器
const player = new TourPlayer(document.getElementById('viewer'));

// 设置渲染器
player.setRenderer(createRendererSync());

// 注册插件
player.use(createHotspotSystem());
player.use(createFullscreenPlugin());
```

### 3. 加载配置

```typescript
const config = {
  version: '1.0',
  scenes: {
    kitchen: {
      title: '厨房',
      source: '/scenes/kitchen.splat',
      initialView: { yaw: 0, pitch: 0, fov: 60 },
    },
  },
};

await player.load(config);
await player.switchScene('kitchen');
```

### 4. COOP/COEP 配置

3DGS 渲染依赖 `SharedArrayBuffer`，需要配置跨域隔离头：

**Vite (开发环境)**

```javascript
// vite.config.js
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
};
```

**Nginx (生产环境)**

```nginx
add_header Cross-Origin-Opener-Policy "same-origin";
add_header Cross-Origin-Embedder-Policy "require-corp";
```

## 下一步

- [配置参考](/guide/configuration) — 了解完整的 TourConfig 字段
- [插件系统](/guide/plugins) — 使用插件扩展功能
- [数据转换](/guide/data-convert) — 使用 CLI 工具转换 3DGS 数据
- [示例](/examples/basic) — 查看更多代码示例
