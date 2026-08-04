# 3DGS Web 渲染引擎

> 轻量级、高性能、高可拓展的 Web 端 3D 高斯溅射（3DGS）渲染引擎与漫游框架

[![CI](https://img.shields.io/github/actions/workflow/status/sacrtap/3dgs/ci.yml?branch=main&label=CI)](https://github.com/sacrtap/3dgs/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@3dgs/core?label=%403dgs%2Fcore)](https://www.npmjs.com/package/@3dgs/core)
[![npm version](https://img.shields.io/npm/v/@3dgs/renderer-three?label=%403dgs%2Frenderer-three)](https://www.npmjs.com/package/@3dgs/renderer-three)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-blue.svg)](https://www.typescriptlang.org)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6e9f18.svg)](https://vitest.dev)
[![Lint](https://img.shields.io/badge/lint-ESLint%20%2B%20Prettier-4b32c3.svg)](https://eslint.org)

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
  - [代码质量](#代码质量)
  - [CI/CD](#cicd)
  - [文档站点](#文档站点)
- [常见问题](#常见问题)
- [数据格式选择指南](#数据格式选择指南)
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
| **SceneTransition** | 场景过渡动画 — fade / fly / instant 三种过渡模式 |
| **Fullscreen** | 全屏切换 — 双击切换、ESC 退出、横屏锁定 |
| **LoadingIndicator** | 加载指示器 — spinner 动画、进度显示、错误状态 |
| **AutoRotate** | 自动旋转 — 可配置速度/延迟，交互时自动暂停 |
| **ShaderInjection** | Shader 注入 — 自定义 GLSL 代码注入到顶点/片段着色器 |

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

### 从 npm 安装

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins three @sparkjsdev/spark
```

### 从源码构建

```bash
git clone https://github.com/sacrtap/3dgs.git
cd 3dgs
pnpm install
pnpm build
```

> **注意**：`three` 和 `@sparkjsdev/spark` 是 `@3dgs/renderer-three` 的 peerDependencies，需要在宿主项目中手动安装（`npm install three @sparkjsdev/spark`）。React 适配层需要 `react`（≥ 18），Vue 适配层需要 `vue`（≥ 3.4）。

### 启动 Demo

```bash
pnpm --filter @3dgs/demo dev
```

浏览器访问 `http://localhost:5173`，体验多场景漫游、热点跳转、深度遮挡、触摸手势、Shader 效果等功能。

> **注意**：Demo 需要 COOP/COEP 跨源隔离头（已在 Vite 配置中设置），以启用 `SharedArrayBuffer`（Spark 排序 Worker 依赖）。

---

## Monorepo 结构

```
3dgs/
├── packages/
│   ├── core/              # 框架无关核心 — TourPlayer、SceneManager、PluginSystem
│   ├── renderer-three/    # Three.js + Spark 渲染器适配层
│   ├── plugins/           # 插件包 — 热点、相机控制、深度遮挡、触摸、过渡、Shader
│   ├── convert/           # 数据转换 CLI + 编程 API
│   ├── react/             # React 适配层 — <TourViewer /> 组件
│   └── vue/               # Vue 3 适配层 — <TourViewer /> 组件
├── apps/
│   └── demo/              # 在线演示应用 (Vite + Vanilla TS)
├── examples/              # 9+ 示例代码
├── docs/                  # 项目文档
│   ├── plan/              # 设计文档与性能分析
│   │   ├── 01-调研说明文档.md
│   │   ├── 02-产品说明文档.md
│   │   ├── 03-详细技术方案.md
│   │   ├── 04-产品实现计划.md
│   │   ├── 05-性能基准报告.md
│   │   └── 06-渲染性能深度分析与优化方案.md
│   └── site/              # VitePress 文档站
├── .changeset/            # Changesets 版本管理
├── .github/               # CI/CD + Issue/PR 模板
├── eslint.config.js        # ESLint flat config (TypeScript + Prettier)
├── .prettierrc.json        # Prettier 代码格式化配置
├── vitest.config.ts        # Vitest 测试框架配置
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
| `ShaderHookPoint` | 枚举 | Shader 注入点 — 顶点/片段着色器 6 个注入位置 |
| `ShaderInjection` | 接口 | Shader 注入定义 — id + hook + code + uniforms |
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
| `createSceneTransitionPlugin(options?)` | 场景过渡动画插件 — fade / fly / instant |
| `createFullscreenPlugin(options?)` | 全屏切换插件 — 双击切换、ESC 退出 |
| `createLoadingIndicatorPlugin(options?)` | 加载指示器插件 — spinner + 进度百分比 |
| `createAutoRotatePlugin(options?)` | 自动旋转插件 — 可配置速度/延迟/方向 |
| `createShaderInjectionPlugin(options?)` | Shader 注入插件 — 自定义 GLSL 代码注入 |
| `HotspotManager` | 热点管理器类 — 可独立使用 |

### @3dgs/convert

3DGS 数据转换工具，提供 CLI 和编程 API 两种使用方式。

**编程 API 导出：**

| 导出 | 说明 |
|------|------|
| `loadGaussiansFromPly(buffer, options?)` | 从 PLY 解析高斯数据 |
| `loadGaussiansFromSplat(buffer, options?)` | 从 `.splat` 文件反向加载为 GaussianCloud |
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
import { useMemo } from 'react';
import { TourViewer } from '@3dgs/react';
import { createRenderer } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';

function App() {
  // ★ 使用 useMemo 稳定引用，避免 TourPlayer 不必要的重建
  const renderer = useMemo(() => createRenderer().then((r) => r.renderer), []);
  const plugins = useMemo(() => [createHotspotSystem()], []);

  return (
    <TourViewer
      config="/tour.json"
      initialScene="kitchen"
      renderer={() => renderer}
      plugins={plugins}
      onSceneSwitch={(sceneId) => console.log('切换场景:', sceneId)}
      onHotspotClick={(hotspotId) => console.log('点击热点:', hotspotId)}
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
```

> **性能提示**：`renderer` 和 `plugins` props 必须使用稳定引用（`useMemo` / `useRef`），否则 TourViewer 会重建 TourPlayer。回调函数（`onLoad`、`onError` 等）内部已用 `useRef` 包裹，无需额外处理。

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

# .splat → .spz / .sog (反向转换)
npx 3dgs-convert splat-to-spz input.splat -o output.spz
npx 3dgs-convert splat-to-sog input.splat -o output.sog

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

### 代码质量

项目集成了完整的代码质量工具链：

```bash
# 类型检查 (tsc --noEmit)
pnpm typecheck

# 单元测试 (Vitest)
pnpm test              # 单次运行
pnpm test:watch        # 监听模式
pnpm test:coverage     # 覆盖率报告

# 代码检查 (ESLint)
pnpm lint              # 检查
pnpm lint:fix          # 自动修复

# 代码格式化 (Prettier)
pnpm format            # 格式化
pnpm format:check      # 检查格式
```

**测试覆盖的核心模块：**

| 包 | 测试文件 | 测试用例 |
|------|----------|----------|
| `@3dgs/core` | `tour-config.test.ts` | 7 |
| `@3dgs/core` | `scene-manager.test.ts` | 13 |
| `@3dgs/core` | `plugin-system.test.ts` | 6 |
| `@3dgs/core` | `tour-loader.test.ts` | 5 |
| `@3dgs/convert` | `ply-parser.test.ts` | 4 |
| `@3dgs/convert` | `processing.test.ts` | 7 |

### CI/CD

GitHub Actions CI 流水线（`.github/workflows/ci.yml`）在每次 push / PR 时自动执行：

| 步骤 | 说明 |
|------|------|
| **Lint** | ESLint 静态检查 (0 errors, 0 warnings) |
| **Type Check** | `tsc --noEmit` 全量类型检查 |
| **Unit Tests** | Vitest 42 个测试用例 |
| **Build** | 全量构建所有包 + Demo + 文档站点 |
| **Benchmark** | Playwright 性能基准测试 (仅 push 触发) |

> CI 运行在 `ubuntu-latest` 上，使用 pnpm + Node.js 20 + 冻结锁文件安装。

### 文档站点

项目使用 [VitePress](https://vitepress.dev) 构建文档站点，包含完整的指南、API 参考和示例代码。

```bash
# 启动开发服务器（热更新，访问 http://localhost:5178）
pnpm --filter @3dgs/docs dev

# 构建静态站点（输出到 docs/site/.vitepress/dist/）
pnpm --filter @3dgs/docs build

# 本地预览构建产物
pnpm --filter @3dgs/docs preview
```

> 文档源码位于 `docs/site/` 目录，配置文件为 `docs/site/.vitepress/config.ts`。
> 开发服务器端口为 **5178**（在 config.ts 中配置），避免与其他服务冲突。

### 项目文档

| 文档 | 说明 |
|------|------|
| [文档站点（在线）](docs/site/) | VitePress 文档 — 指南、API 参考、示例 |
| [示例代码](examples/README.md) | 9 个可运行示例代码 |
| [FAQ 常见问题](docs/site/guide/faq.md) | 部署、渲染、转换、插件、构建常见问题 |
| [贡献指南](CONTRIBUTING.md) | 开发环境、分支策略、插件开发、提交规范 |
| [渲染性能深度分析](docs/plan/06-渲染性能深度分析与优化方案.md) | P0/P1/P2 优化方案与基准测试报告 |

---

## 常见问题

常见问题及解答请参考 [FAQ 文档](docs/site/guide/faq.md)，涵盖：

- **部署** — COOP/COEP 配置、GitHub Pages 替代方案、CORS 问题
- **渲染** — 移动端性能优化、摄像机定位、移动速度调整
- **数据转换** — PLY → SPZ 压缩比、颜色异常、批量转换失败处理
- **插件** — 热点不显示、React 组件重建、Shader 注入不生效
- **构建** — TypeScript 类型报错、包体积优化、本地开发版本使用

---

## 数据格式选择指南

3DGS 渲染引擎支持三种 Web 加载格式: `.splat`、`.spz`、`.sog`。三者的**稳态渲染 FPS 基本一致**（差异 < 5%），格式选择主要影响加载体验和 LOD 质量。

### 格式特性对比

| 特性 | .splat | .spz | .sog |
|------|--------|------|------|
| **每 splat 字节** | 32 B | ~16 B (压缩前) | 32 B (同 .splat) |
| **压缩** | 无 | gzip + 量化 | 无 (分块传输) |
| **SH 球谐系数** | ✗ | ✓ (degree 0-3) | ✗ |
| **流式加载** | ✗ | ✗ | ✓ (HTTP Range) |
| **Morton 排序** | ✗ | ✗ | ✓ (LOD 友好) |
| **位置精度** | Float32 | 24bit 定点 | Float32 |
| **网络传输** | 全量 | 全量 (压缩) | 渐进式 |
| **CPU 解码开销** | 最低 | 中 (解压+反量化) | 低 |

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

### 格式转换

```bash
# PLY → SPLAT
npx 3dgs-convert ply-to-splat input.ply -o output.splat

# PLY → SPZ (gzip 压缩)
npx 3dgs-convert ply-to-spz input.ply -o output.spz --sh-degree 1

# PLY → SOG (流式 LOD)
npx 3dgs-convert ply-to-sog input.ply -o output.sog

# .splat → .spz / .sog (反向转换)
npx 3dgs-convert splat-to-spz input.splat -o output.spz
npx 3dgs-convert splat-to-sog input.splat -o output.sog
```

> 详见 [渲染性能深度分析与优化方案](docs/06-渲染性能深度分析与优化方案.md)。

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
