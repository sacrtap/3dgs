# 3DGS Web 渲染引擎

> 轻量级、高性能、高可拓展的 Web 端 3D 高斯溅射（3DGS）渲染引擎与漫游框架

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-blue.svg)](https://www.typescriptlang.org)

---

## 目录

- [项目介绍](#项目介绍)
- [核心特性](#核心特性)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [Monorepo 结构](#monorepo-结构)
- [包说明](#包说明)
  - [@3dgs/core](#3dgscore)
  - [@3dgs/renderer-three](#3dgsrenderer-three)
  - [@3dgs/plugins](#3dgsplugins)
  - [@3dgs/convert](#3dgsconvert)
  - [@3dgs/react](#3dgsreact)
  - [@3dgs/vue](#3dgsvue)
- [使用说明](#使用说明)
  - [Vanilla JS / TS](#vanilla-js--ts)
  - [React](#react)
  - [Vue 3](#vue-3)
  - [CLI 数据转换工具](#cli-数据转换工具)
  - [配置系统](#配置系统)
  - [插件开发](#插件开发)
- [开发指南](#开发指南)
- [浏览器兼容性](#浏览器兼容性)
- [许可证](#许可证)

---

## 项目介绍

本项目是一个面向 Web 端的 3DGS（3D Gaussian Splatting）渲染引擎与漫游框架，旨在让开发者无需理解底层渲染技术即可在网页中嵌入和定制 3DGS 场景浏览体验。

### 设计哲学

| 原则 | 说明 |
|------|------|
| **轻量级** | 核心包零运行时依赖，按需加载 |
| **高性能** | 桌面端 60fps，移动端 30fps，自适应分辨率保障流畅 |
| **高可拓展** | 插件化架构，热点、相机控制等领域功能均为插件 |
| **框架无关** | 核心 SDK 与前端框架解耦，提供 React / Vue 薄适配层 |
| **开箱即用** | 配置驱动，3 行代码嵌入 3DGS 场景 |

### 典型使用场景

- **房产虚拟看房** — 多房间场景漫游 + 热点跳转
- **博物馆数字化展览** — 展厅漫游 + 展品信息热点
- **产品 3D 展示** — 高保真渲染 + 交互标注
- **文旅数字孪生** — 大场景流式 LOD 加载

---

## 核心特性

### 渲染引擎

- **WebGPU 自动检测** — 检测设备 WebGPU 能力，不可用时自动回退 WebGL2
- **Spark 渲染后端** — 基于 `@sparkjsdev/spark` 实现 WebGL2 3DGS 渲染，覆盖 98%+ 浏览器
- **设备分级** — 自动检测硬件能力（CPU 核心数、内存、GPU 型号），动态选择渲染参数
- **自适应分辨率** — 帧率低于阈值时自动降低渲染分辨率，保障流畅度
- **单一 RAF 循环** — 渲染器统一管理 `requestAnimationFrame`，插件通过 `onFrame()` 挂载，杜绝双 RAF
- **DragLookControls** — 拖拽式视角控制，类似全景查看器交互（原地转头，非绕点旋转）
- **键盘移动** — WASD 水平移动 + QE 升降，带速度插值平滑

### 数据格式

| 格式 | 说明 | 压缩比 |
|------|------|--------|
| **PLY** | 原始 3DGS 训练输出格式 | 1× |
| **SPLAT** | antimatter15 格式（32 字节/splat） | ~1× |
| **SPZ** | Niantic SPZ v2 格式（gzip 压缩） | ~10× |
| **SOG** | Spatially Ordered Gaussians（流式 LOD） | 按需加载 |

### 漫游框架

- **声明式配置** — `tour.json` 定义场景拓扑、相机参数、质量设置
- **多场景管理** — 场景注册、切换、预加载
- **插件系统** — 热点、相机控制、深度遮挡等均为可插拔插件
- **事件总线** — 插件间通信与外部事件监听

### 插件生态

| 插件 | 说明 |
|------|------|
| **HotspotSystem** | 热点系统 — 场景跳转、信息标注、URL 链接、自动预加载目标场景 |
| **CameraControls** | 相机控制 — 鼠标拖拽旋转、滚轮缩放、阻尼平滑 |
| **DepthOcclusion** | 深度遮挡检测 — WebGL2 `readPixels` 检测热点被高斯核遮挡，半透明显示 |
| **TouchGestures** | 多指触摸手势 — 双指捏合缩放、双指旋转、惯性滚动 |

---

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    应用层 (React / Vue)                    │
│              <TourViewer config={...} />                 │
├─────────────────────────────────────────────────────────┤
│              @3dgs/core (框架无关核心)                     │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌───────────┐ │
│  │TourPlayer│ │SceneManager│ │TourLoader│ │PluginSystem│ │
│  └────┬─────┘ └────────────┘ └──────────┘ └─────┬─────┘ │
│       │           RendererAdapter (接口)          │       │
├───────┼───────────────────────────────────────────┼───────┤
│       │   @3dgs/renderer-three (Three.js + Spark)  │       │
│       │   ┌────────────┐ ┌──────────────┐         │       │
│       │   │RenderManager│ │DeviceTier 检测│         │       │
│       │   └────────────┘ └──────────────┘         │       │
│       │   ┌────────────┐ ┌──────────────┐         │       │
│       │   │WebGPU 检测  │ │ SogStreamer  │         │       │
│       │   └────────────┘ └──────────────┘         │       │
├───────┴───────────────────────────────────────────┴───────┤
│                @3dgs/plugins (插件包)                      │
│  ┌──────────┐ ┌──────────────┐ ┌────────┐ ┌────────────┐ │
│  │ Hotspot  │ │CameraControls│ │Depth   │ │TouchGestures│ │
│  │ System   │ │              │ │Occlusion│ │             │ │
│  └──────────┘ └──────────────┘ └────────┘ └────────────┘ │
├─────────────────────────────────────────────────────────┤
│              @3dgs/convert (CLI + 编程 API)               │
│    PLY → SPLAT / SPZ / SOG  ·  批量转换  ·  Tour 生成     │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8（Monorepo 包管理器）

### 安装依赖

```bash
cd 3dgs
pnpm install
```

### 构建所有包

```bash
pnpm build
```

### 启动 Demo

```bash
pnpm --filter @3dgs/demo dev
```

浏览器访问 `http://localhost:5173`，体验多场景漫游、热点跳转、深度遮挡、触摸手势等功能。

> **注意**：Demo 需要 COOP/COEP 跨源隔离头（已在 Vite 配置中设置），以启用 `SharedArrayBuffer`（Spark 排序 Worker 依赖）。

---

## Monorepo 结构

```
3dgs/
├── packages/
│   ├── core/              # 框架无关核心 — TourPlayer、SceneManager、PluginSystem
│   ├── renderer-three/    # Three.js + Spark 渲染器适配层
│   ├── plugins/           # 插件包 — 热点、相机控制、深度遮挡、触摸手势
│   ├── convert/           # 数据转换 CLI + 编程 API
│   ├── react/             # React 适配层 — <TourViewer /> 组件
│   └── vue/               # Vue 3 适配层 — <TourViewer /> 组件
├── apps/
│   └── demo/              # 在线演示应用 (Vite + Vanilla TS)
├── docs/                  # 项目文档
│   ├── 01-调研说明文档.md
│   ├── 02-产品说明文档.md
│   ├── 03-详细技术方案.md
│   └── 04-产品实现计划.md
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

---

## 包说明

### @3dgs/core

框架无关的 3DGS 漫游播放器核心，零运行时依赖。

**核心导出：**

| 导出 | 类型 | 说明 |
|------|------|------|
| `TourPlayer` | 类 | 漫游播放器 — 帧循环管理、场景切换、插件编排、事件总线 |
| `SceneManager` | 类 | 场景注册、加载、切换、预加载 |
| `TourLoader` | 类 | 从 URL 或对象加载 TourConfig，带缓存和 abort 支持 |
| `PluginSystem` | 类 | 插件注册、每帧更新、销毁管理 |
| `RendererAdapter` | 接口 | 渲染器抽象接口 — 解耦 TourPlayer 与具体渲染后端 |
| `DeviceTier` | 枚举 | 设备分级 — LOW / MEDIUM / HIGH / ULTRA |
| `TourConfig` | 类型 | 声明式场景图配置格式 |
| `TourPlugin` | 接口 | 插件接口 — `init` / `update` / `destroy` 生命周期 |
| `validateTourConfig` | 函数 | 配置验证 |

### @3dgs/renderer-three

基于 Three.js + `@sparkjsdev/spark` 的渲染器适配层。

**核心导出：**

| 导出 | 类型 | 说明 |
|------|------|------|
| `RenderManager` | 类 | WebGL2 + Spark 渲染管理器，实现 `RendererAdapter` 接口 |
| `createRenderer` | 函数 | 异步渲染器工厂 — 自动检测 WebGPU，不可用回退 WebGL2 |
| `createRendererSync` | 函数 | 同步渲染器工厂 — 直接使用 WebGL2（跳过 WebGPU 检测） |
| `detectWebGPU` | 函数 | WebGPU 能力检测（adapter 信息、限制项） |
| `detectDeviceTier` | 函数 | 设备分级检测（CPU/GPU/内存/移动端） |
| `SogStreamer` | 类 | SOG 流式 LOD 客户端 — HTTP Range 分块加载 |

**RenderManager 选项：**

```typescript
interface RenderManagerOptions {
  deviceTier?: DeviceTier;          // 强制设备分级
  pixelRatio?: number;              // 像素比覆盖
  resolutionScale?: number;         // 初始分辨率缩放比
  adaptiveResolution?: boolean;     // 自适应分辨率（默认 true）
  clearColor?: number;              // 清除色
  enableKeyboardControls?: boolean; // 键盘控制（默认 true）
  moveSpeed?: number;               // 移动速度（默认 5.0）
  verticalSpeed?: number;           // 升降速度（默认 3.0）
  autoOrient?: boolean;             // 加载后垂直翻转（默认 true）
  enableLod?: boolean;              // 构建 LOD 树（默认 true）
}
```

### @3dgs/plugins

3DGS 漫游框架插件包，提供热点系统、相机控制等领域能力。

**核心导出：**

| 导出 | 说明 |
|------|------|
| `createHotspotSystem(options?)` | 热点系统插件 — 场景跳转、信息标注、URL 链接、自动预加载 |
| `createCameraControls(options?)` | 相机控制插件 — 拖拽旋转、滚轮缩放、阻尼平滑 |
| `createDepthOcclusionPlugin(options?)` | 深度遮挡检测插件 — `readPixels` 检测遮挡，半透明显示 |
| `createTouchGesturesPlugin(options?)` | 多指触摸手势插件 — 捏合缩放、双指旋转、惯性滚动 |
| `HotspotManager` | 热点管理器类 — 可独立使用 |

### @3dgs/convert

3DGS 数据转换工具，提供 CLI 和编程 API 两种使用方式。

**编程 API 导出：**

| 导出 | 说明 |
|------|------|
| `loadGaussiansFromPly(buffer, options?)` | 从 PLY 解析高斯数据 |
| `writeSplat(cloud)` | 写入 `.splat` 格式 |
| `writeSpz(cloud, options?)` | 写入 `.spz` 格式（gzip 压缩） |
| `writeSog(cloud, options?)` | 写入 `.sog` 格式（流式 LOD） |
| `pruneGaussians(cloud, options?)` | 冗余高斯核剔除 |
| `mortonSortGaussians(cloud, options?)` | Morton Code 空间排序 |
| `parsePly(buffer)` | 底层 PLY 解析器 |
| `parseSogMetadata(buffer)` | 解析 SOG 文件元数据 |

### @3dgs/react

React 适配层，提供 `<TourViewer />` 组件。

**Props：**

| Prop | 类型 | 说明 |
|------|------|------|
| `config` | `string \| TourConfig` | 漫游配置（URL 或对象） |
| `renderer` | `RendererAdapter \| (() => RendererAdapter)` | 渲染器实例或工厂函数（必需） |
| `plugins` | `TourPlugin[]` | 插件列表 |
| `initialScene` | `string` | 初始场景 ID |
| `onLoad` | `(data) => void` | 加载完成回调 |
| `onSceneSwitch` | `(sceneId) => void` | 场景切换回调 |
| `onHotspotClick` | `(hotspotId) => void` | 热点点击回调 |
| `onError` | `(error) => void` | 错误回调 |

### @3dgs/vue

Vue 3 适配层，提供 `<TourViewer />` 组件。

**Props：** `config`、`renderer`、`plugins`、`initialScene`

**Emits：** `load`、`scene-switch`、`hotspot-click`、`error`

---

## 使用说明

### Vanilla JS / TS

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';
import {
  createHotspotSystem,
  createDepthOcclusionPlugin,
  createTouchGesturesPlugin,
} from '@3dgs/plugins';

// 1. 创建播放器
const player = new TourPlayer(document.getElementById('viewer'));

// 2. 创建渲染器（自动检测 WebGPU，回退 WebGL2）
const { renderer, backend } = await createRenderer();
player.setRenderer(renderer);

// 3. 注册插件
player.use(createHotspotSystem());
player.use(createDepthOcclusionPlugin({ sampleInterval: 2 }));
player.use(createTouchGesturesPlugin());

// 4. 事件监听
player.on('load', () => console.log('加载完成'));
player.on('scene:switched', (data) => console.log('切换场景:', data));
player.on('hotspot:click', (data) => console.log('点击热点:', data));
player.on('error', (data) => console.error('错误:', data));

// 5. 加载配置并启动
await player.load('/tour.json');
await player.switchScene('kitchen');

// 销毁
// player.destroy();
```

### React

```tsx
import { TourViewer } from '@3dgs/react';
import { createRenderer } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';

function App() {
  return (
    <TourViewer
      config="/tour.json"
      initialScene="kitchen"
      renderer={() => createRenderer().then((r) => r.renderer)}
      plugins={[createHotspotSystem()]}
      onSceneSwitch={(sceneId) => console.log('切换场景:', sceneId)}
      onHotspotClick={(hotspotId) => console.log('点击热点:', hotspotId)}
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
```

### Vue 3

```vue
<script setup lang="ts">
import { TourViewer } from '@3dgs/vue';
import { createRenderer } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';
import type { TourConfig } from '@3dgs/core';

const config: TourConfig = {
  version: '1.0',
  scenes: {
    kitchen: {
      source: '/kitchen.splat',
      initialView: { yaw: 0, pitch: 0, fov: 60 },
    },
  },
};

function createRendererInstance() {
  return createRenderer().then((r) => r.renderer);
}

const plugins = [createHotspotSystem()];
</script>

<template>
  <TourViewer
    :config="config"
    :renderer="createRendererInstance"
    :plugins="plugins"
    initial-scene="kitchen"
    @scene-switch="(id) => console.log('切换场景:', id)"
    @hotspot-click="(id) => console.log('点击热点:', id)"
    style="width: 100vw; height: 100vh;"
  />
</template>
```

### CLI 数据转换工具

将 PLY 文件转换为优化的 Web 加载格式：

```bash
# PLY → SPLAT (无压缩，最快加载)
npx 3dgs-convert ply-to-splat input.ply --output output.splat

# PLY → SPZ (gzip 压缩，~10x 压缩比)
npx 3dgs-convert ply-to-spz input.ply --output output.spz --sh-degree 1

# PLY → SOG (流式 LOD，支持渐进式加载)
npx 3dgs-convert ply-to-sog input.ply --output output.sog --chunk-size 16384

# 批量转换目录下所有 PLY 文件
npx 3dgs-convert batch ./scenes/ --format spz --sh-degree 1

# 生成 tour.json 配置模板
npx 3dgs-convert generate-tour ./scenes/ --output tour.json --base-url ./

# 查看文件信息
npx 3dgs-convert info input.ply
```

**CLI 选项说明：**

| 选项 | 说明 |
|------|------|
| `-o, --output <path>` | 输出文件路径 |
| `--prune` | 启用冗余剔除（过滤低透明度/异常高斯核） |
| `--min-opacity <num>` | 最小不透明度阈值（默认 0.01） |
| `--sort` | 启用 Morton Code 空间排序 |
| `--no-sort` | 禁用排序（仅 SOG 命令，SOG 默认启用排序） |
| `--sh-degree <num>` | SH 阶数 0-3（默认自动检测） |
| `--fractional-bits <num>` | SPZ 位置量化小数位（默认 12） |
| `--chunk-size <num>` | SOG 每 chunk 的 splat 数（默认 16384） |

### 配置系统

漫游配置使用声明式 JSON 格式（`tour.json`），定义场景拓扑、相机参数、质量设置和插件扩展：

```json
{
  "version": "1.0",
  "meta": {
    "title": "虚拟看房",
    "description": "三室一厅漫游"
  },
  "defaults": {
    "camera": {
      "fov": 60,
      "minFov": 30,
      "maxFov": 90,
      "limitPitch": [-80, 80]
    },
    "transition": {
      "type": "fade",
      "duration": 800
    },
    "quality": {
      "maxSplats": 1000000,
      "shDegree": 1,
      "resolution": 1.0,
      "antialias": false,
      "pixelRatio": 1.0
    }
  },
  "scenes": {
    "kitchen": {
      "title": "厨房",
      "source": "/kitchen.spz",
      "lodSource": "/kitchen.sog",
      "initialView": { "yaw": 0, "pitch": 0, "fov": 60 },
      "extensions": {
        "hotspot": {
          "hotspots": [
            {
              "id": "to-living",
              "type": "scene",
              "position": [1.0, 1.5, -2.0],
              "targetScene": "living",
              "transition": { "type": "fade", "duration": 600 },
              "style": { "glow": true, "pulse": true, "color": "#80a0ff", "size": 36 },
              "onHover": { "tooltip": "点击进入客厅" }
            },
            {
              "id": "info-label",
              "type": "text",
              "position": [0.5, 1.2, -1.0],
              "onHover": { "tooltip": "信息标注" }
            }
          ]
        }
      }
    },
    "living": {
      "title": "客厅",
      "source": "/living.spz",
      "initialView": { "yaw": 90, "pitch": 0, "fov": 60 }
    }
  }
}
```

**热点类型：** `scene`（场景跳转）、`text`（信息标注）、`url`（链接跳转）、`image`（图片）、`custom`（自定义）

### 插件开发

实现 `TourPlugin` 接口即可创建自定义插件：

```typescript
import type { TourPlugin, FrameContext, TourPluginContext } from '@3dgs/core';

function createMyPlugin(): TourPlugin {
  let ctx: TourPluginContext;

  return {
    name: 'my-plugin',
    version: '1.0.0',

    // 初始化（在 player.load() 前调用）
    init(pluginCtx: TourPluginContext) {
      ctx = pluginCtx;
      // 通过 ctx.player 访问播放器
      // 通过 ctx.renderer 访问渲染器
      // 通过 ctx.container 访问 DOM 容器
      // 通过 ctx.sceneManager 访问场景管理器
    },

    // 每帧更新（挂载在渲染器的单一 RAF 循环上）
    update(frameCtx: FrameContext) {
      // frameCtx.camera — 相机位置 {x, y, z}
      // frameCtx.vpMatrix — 视图投影矩阵 (Float32Array, 16 元素)
      // frameCtx.size — 视口尺寸 {width, height}
      // frameCtx.deltaTime — 帧间隔时间 (ms)
    },

    // 销毁
    destroy() {
      // 清理资源
    },
  };
}

// 使用
player.use(createMyPlugin());
```

**插件间通信：** 通过 `player.emit()` 和 `player.on()` 实现插件间事件通信。

---

## 开发指南

### 构建

```bash
# 构建所有包
pnpm build

# 构建单个包
pnpm --filter @3dgs/core build

# 监听模式
pnpm --filter @3dgs/core dev
```

### 开发工作流

```bash
# 1. 安装依赖
pnpm install

# 2. 启动所有包的 watch 模式
pnpm dev

# 3. 启动 Demo（另一个终端）
pnpm --filter @3dgs/demo dev
```

### 项目文档

| 文档 | 说明 |
|------|------|
| [调研说明文档](docs/01-调研说明文档.md) | 3DGS 技术调研、竞品分析、技术选型 |
| [产品说明文档](docs/02-产品说明文档.md) | 产品定位、功能规划、配置系统、插件生态 |
| [详细技术方案](docs/03-详细技术方案.md) | 架构设计、核心模块实现、API 规格 |
| [产品实现计划](docs/04-产品实现计划.md) | 分阶段实施计划与完成状态 |

---

## 浏览器兼容性

| 浏览器 | 最低版本 | 说明 |
|--------|---------|------|
| Chrome / Edge | 113+ | WebGL2 + SharedArrayBuffer（COOP/COEP） |
| Firefox | 113+ | WebGL2 + SharedArrayBuffer |
| Safari | 16.4+ | WebGL2（部分功能受限） |
| 移动端 Chrome | 113+ | 支持触摸手势 |
| 移动端 Safari | 16.4+ | 支持触摸手势 |

> **跨源隔离要求**：服务端需设置以下 HTTP 头以启用 `SharedArrayBuffer`：
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> Cross-Origin-Resource-Policy: cross-origin
> ```

---

## 许可证

MIT
