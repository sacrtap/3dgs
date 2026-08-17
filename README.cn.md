# 3DGS Web 渲染引擎

> 轻量级、高性能、高可拓展的 Web 端 3D 高斯溅射（3DGS）渲染引擎与漫游框架

[![CI](https://img.shields.io/github/actions/workflow/status/sacrtap/3dgs/ci.yml?branch=main&label=CI)](https://github.com/sacrtap/3dgs/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@3dgs/core?label=%403dgs%2Fcore)](https://www.npmjs.com/package/@3dgs/core)
[![npm version](https://img.shields.io/npm/v/@3dgs/renderer-three?label=%403dgs%2Frenderer-three)](https://www.npmjs.com/package/@3dgs/renderer-three)
[![npm downloads](https://img.shields.io/npm/dm/@3dgs/core?label=downloads)](https://www.npmjs.com/package/@3dgs/core)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-blue.svg)](https://www.typescriptlang.org)

[English](README.md) | **中文**

---

## 快速开始

### 1. 安装

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins three @sparkjsdev/spark
```

> **React 项目** 额外需要 `npm install react`（≥ 18）
> **Vue 项目** 额外需要 `npm install vue`（≥ 3.4）

### 2. 3 行代码嵌入 3DGS 场景

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';

const player = new TourPlayer(document.getElementById('viewer'));
const { renderer } = await createRenderer();
player.setRenderer(renderer);
await player.load('/tour.json');  // 加载场景配置，立即渲染
```

### 3. 在线体验 Demo

```bash
git clone https://github.com/sacrtap/3dgs.git
cd 3dgs && pnpm install && pnpm --filter @3dgs/demo dev
```

浏览器访问 `http://localhost:5173`，体验多场景漫游、热点跳转、深度遮挡、触摸手势等功能。

<details>
<summary>📦 需要了解的依赖说明</summary>

- `three` 和 `@sparkjsdev/spark` 是 `@3dgs/renderer-three` 的 peerDependencies，需手动安装
- Demo 需要 COOP/COEP 跨源隔离头（已在 Vite 配置中设置），以启用 `SharedArrayBuffer`

</details>

---

## 目录

- [快速开始](#快速开始)
- [核心特性](#核心特性)
- [框架集成](#框架集成)
  - [React](#react)
  - [Vue 3](#vue-3)
- [数据转换工具](#数据转换工具)
- [配置系统](#配置系统)
- [插件](#插件)
- [数据格式选择指南](#数据格式选择指南)
- [浏览器兼容性](#浏览器兼容性)
- [开发指南](#开发指南)
- [常见问题](#常见问题)
- [许可证](#许可证)

---

## 核心特性

### 渲染引擎

- **双后端** — WebGL2 + Spark（生产就绪，覆盖 98%+ 浏览器）**及** WebGPU 原生（实验性，WGSL 着色器 + GPU compute 排序）
- **设备分级** — 自动检测硬件能力（CPU 核心数、内存、GPU 型号），动态选择渲染参数
- **自适应分辨率** — 帧率低于阈值时自动降低渲染分辨率，保障流畅度
- **DragLookControls** — 拖拽式视角控制，类似全景查看器交互
- **键盘移动** — WASD 水平移动 + QE 升降，带速度插值平滑

### 漫游框架

- **声明式配置** — `tour.json` 定义场景拓扑、相机参数、质量设置
- **多场景管理** — 场景注册、切换、预加载
- **插件系统** — 热点、相机控制、深度遮挡等均为可插拔插件
- **事件总线** — 插件间通信与外部事件监听

### 数据格式

| 格式 | 说明 | 压缩比 |
|------|------|--------|
| **PLY** | 原始 3DGS 训练输出格式 | 1× |
| **SPLAT** | antimatter15 格式（32 字节/splat） | ~1× |
| **SPZ** | Niantic SPZ v2 格式（gzip 压缩） | ~10× |
| **SOG** | Spatially Ordered Gaussians（流式 LOD） | 按需加载 |

### 插件生态

| 插件 | 说明 |
|------|------|
| **HotspotSystem** | 热点系统 — 场景跳转、信息标注、URL 链接、自动预加载 |
| **CameraControls** | 相机控制 — 鼠标拖拽旋转、滚轮缩放、阻尼平滑 |
| **DepthOcclusion** | 深度遮挡检测 — 热点被遮挡时半透明显示 |
| **TouchGestures** | 多指触摸手势 — 捏合缩放、双指旋转、惯性滚动 |
| **SceneTransition** | 场景过渡动画 — fade / fly / instant |
| **Fullscreen** | 全屏切换 — 双击切换、ESC 退出 |
| **LoadingIndicator** | 加载指示器 — spinner 动画、进度显示 |
| **AutoRotate** | 自动旋转 — 可配置速度/延迟 |
| **ShaderInjection** | Shader 注入 — 自定义 GLSL（WebGL2）/ WGSL（WebGPU）代码注入 |

---

## 框架集成

### React

```tsx
import { useMemo } from 'react';
import { TourViewer } from '@3dgs/react';
import { createRenderer } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';

function App() {
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

> **性能提示**：`renderer` 和 `plugins` props 必须使用稳定引用（`useMemo` / `useRef`），否则 TourViewer 会重建 TourPlayer。

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

### Vanilla JS / TS

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';
import {
  createHotspotSystem,
  createDepthOcclusionPlugin,
  createTouchGesturesPlugin,
} from '@3dgs/plugins';

const player = new TourPlayer(document.getElementById('viewer'));
const { renderer } = await createRenderer();
player.setRenderer(renderer);

player.use(createHotspotSystem());
player.use(createDepthOcclusionPlugin({ sampleInterval: 2 }));
player.use(createTouchGesturesPlugin());

player.on('load', () => console.log('加载完成'));
player.on('scene:switched', (data) => console.log('切换场景:', data));
player.on('hotspot:click', (data) => console.log('点击热点:', data));

await player.load('/tour.json');
await player.switchScene('kitchen');

// player.destroy();
```

---

## 数据转换工具

`@3dgs/convert` 包已[发布到 npm](https://www.npmjs.com/package/@3dgs/convert)（v0.2.0）。可以直接通过 `npx` 使用，无需安装；也可以全局安装后使用：

```bash
# 通过 npx 直接使用（无需安装）
npx 3dgs-convert <命令> [选项]

# 或全局安装
npm install -g @3dgs/convert
3dgs-convert <命令> [选项]
```

将 PLY 文件转换为优化的 Web 加载格式：

```bash
# PLY → SPLAT (无压缩，最快加载)
npx 3dgs-convert ply-to-splat input.ply -o output.splat

# PLY → SPZ (gzip 压缩，~10x 压缩比)
npx 3dgs-convert ply-to-spz input.ply -o output.spz --sh-degree 1

# PLY → SOG (流式 LOD，支持渐进式加载)
npx 3dgs-convert ply-to-sog input.ply -o output.sog

# .splat → .spz / .sog (反向转换)
npx 3dgs-convert splat-to-spz input.splat -o output.spz
npx 3dgs-convert splat-to-sog input.splat -o output.sog

# 批量转换目录下所有 PLY 文件
npx 3dgs-convert batch ./scenes/ --format spz --sh-degree 1

# 生成 tour.json 配置模板
npx 3dgs-convert generate-tour ./scenes/ -o tour.json

# 查看文件信息
npx 3dgs-convert info input.ply
```

<details>
<summary>CLI 选项说明</summary>

| 选项 | 说明 |
|------|------|
| `-o, --output <path>` | 输出文件路径 |
| `--prune` | 启用冗余剔除（过滤低透明度/异常高斯核） |
| `--min-opacity <num>` | 最小不透明度阈值（默认 0.01） |
| `--sort` | 启用 Morton Code 空间排序 |
| `--no-sort` | 禁用排序（仅 SOG 命令，SOG 默认启用排序） |
| `--sh-degree <num>` | SH 阶数 0-3（默认自动检测） |
| `--fractional-bits <num>` | SPZ 位置量化小数位（默认 12） |
| `--chunk-size <num>` | SOG 每 chunk 的 splat 数（默认 8192） |
| `--contribution-cutoff <num>` | 贡献度裁剪（0-1=保留比例，>1=保留数量） |
| `--sh-mode <num>` | SOG SH DC 追加模式（0=off, 1=Int8，默认 0） |

</details>

<details>
<summary>参数指南：质量、体积与性能调优</summary>

### 剔除与过滤（`--prune`、`--min-opacity`、`--contribution-cutoff`）

这些参数控制转换时**保留哪些高斯核**、丢弃哪些。剔除会减小文件体积、提升运行时性能，但会损失视觉精度。

| 参数 | 对质量的影响 | 对文件体积的影响 | 使用场景 |
|------|-------------|-----------------|----------|
| `--prune` | 启用基础过滤：移除 NaN/Inf 异常高斯核、完全透明的高斯核（不透明度低于 `--min-opacity`）、缩放异常的高斯核。视觉影响极小。 | 轻微减小（~1-5%） | 始终推荐 — 清理训练噪声 |
| `--min-opacity 0.01`（默认） | 不透明度低于此值的高斯核被视为不可见。值越低 = 保留更多近透明高斯核；值越高 = 更激进地剔除。 | 值越高 → 文件越小 | 移动端/Web 可调至 `0.05`；存档质量保留 `0.01` |
| `--min-opacity 0.05` | 剔除更多低贡献高斯核。可能丢失细微的雾气/朦胧效果。 | 中等减小（~5-15%） | 移动端、低端设备、带宽受限场景 |
| `--contribution-cutoff 0.8` | 仅保留贡献度排名前 80% 的高斯核（贡献度 = 不透明度 × 最大缩放值）。丢弃底部 20% — 通常是训练噪声或背景填充。 | ~20% 减小 | Web 部署的质量-体积折中 |
| `--contribution-cutoff 500000` | 精确保留贡献度排名前 500,000 个高斯核。适合硬性限制 splat 数量。 | 原始数据量大时显著减小 | 强制设备分级限制（如移动端最多 50 万 splat） |

**质量调优建议：**
- 从 `--prune --min-opacity 0.01`（安全默认值）开始，目视检查输出效果。
- 如果文件体积过大，尝试 `--contribution-cutoff 0.8`（保留前 80%）。
- 移动端目标推荐 `--contribution-cutoff 500000 --min-opacity 0.05` 作为起点。
- 始终将转换输出与源 PLY 渲染效果对比，评估质量损失。

### SH 阶数（`--sh-degree`）— 仅 SPZ 格式

控制输出中保留的球谐函数（视角依赖颜色）级别。越高 = 角度颜色精度越好，但文件越大。

| 值 | SH 项数 | 每 splat 额外体积 | 视觉效果 |
|----|--------|-------------------|----------|
| `0` | 仅 DC | 0 字节 | 纯色，无视角依赖着色 |
| `1` | 3 个系数 | +9 字节 | 基础方向着色（Web 推荐） |
| `2` | 8 个系数 | +24 字节 | 高质量反射、各向异性效果 |
| `3` | 15 个系数 | +45 字节 | 完整 SH 精度（匹配训练源） |

- **默认值**：从 PLY 文件的 SH 数量自动检测。
- `--sh-degree 0` 剥离所有 SH 数据 — 文件最小，但旋转时表面看起来很平。
- `--sh-degree 1` 是 Web 的甜蜜点：以 ~30% 体积增量捕获大部分视角依赖效果。
- 仅 `ply-to-spz` 和 `batch` 命令支持此选项（`.splat` 格式不含 SH）。

### 位置量化精度（`--fractional-bits`）— 仅 SPZ 格式

通过定点量化控制高斯核**位置**的精度。值越低 = 文件越小，但位置抖动越大。

| 值 | 精度（100m 场景） | 文件影响 | 视觉影响 |
|----|------------------|----------|----------|
| `12`（默认） | ~0.024 mm | 基准 | 不可感知 |
| `10` | ~0.098 mm | ~3% 更小 | 可忽略 |
| `8` | ~0.39 mm | ~6% 更小 | 近距离有轻微重影 |
| `14` | ~0.006 mm | ~3% 更大 | 亚像素精度（多数场景无需） |

- 量化范围为 ±8,388,607（24 位有符号），`fractionalBits` 决定世界空间分辨率。
- 典型室内场景（~10m），即使 `fractionalBits=10` 也能提供亚毫米精度。
- 大型室外场景（~1km），保持 `fractionalBits=12` 以避免可见的位置误差。

### SOG 分块大小（`--chunk-size`）— 仅 SOG 格式

控制流式加载时每个 chunk 包含多少高斯核。更小的 chunk = 首帧更快但 HTTP 请求更多。

| 值 | 首 chunk 下载量 | 总 chunk 数（100 万 splat） | 使用场景 |
|----|----------------|---------------------------|----------|
| `8192`（默认） | ~256 KB（32B/splat） | ~122 | 首帧速度与开销平衡 |
| `4096` | ~128 KB | ~244 | 慢速网络首帧更快 |
| `16384` | ~512 KB | ~61 | 压缩比更好，首帧更慢 |
| `32768` | ~1 MB | ~31 | 本地/高带宽最佳，压缩最大化 |

- 每个 chunk 独立 gzip 压缩，因此更大的 chunk 能获得更好的压缩比。
- 更小的 chunk 能更快开始渐进式渲染，但增加每 chunk 开销（HTTP 头、解压）。
- 默认 `8192` 针对典型 Web 部署（3G/4G 网络）调优。

### SOG SH 模式（`--sh-mode`）— 仅 SOG 格式

控制是否在 SOG 文件的每个 splat 后追加 SH DC（0 阶球谐函数）颜色数据，启用视角依赖着色。

| 值 | 额外字节/splat | 文件体积增幅 | 效果 |
|----|---------------|-------------|------|
| `0`（默认） | 0 | 基准 | 无视角依赖颜色；使用 .splat 格式的平坦 DC 颜色 |
| `1` | +3 字节 | ~+9.4% | 追加 Int8 量化的 SH DC 系数，启用基础方向颜色变化 |

- `--sh-mode 1` 适用于源 PLY 有 SH 数据但你希望 SOG 流式加载同时具备视角依赖着色的场景。
- 额外的 3 字节存储 R/G/B 三个 SH DC 系数（Int8 量化：`round(sh × 128) + 128`）。
- 这是完整 SH 保留的轻量替代方案 — 仅保留 DC 项，不保留高阶 SH。

### Morton 空间排序（`--sort` / `--no-sort`）

控制写入前是否按 3D 位置（Z-order / Morton 曲线）重新排列高斯核。

| 设置 | 效果 | 使用时机 |
|------|------|----------|
| `--sort`（splat/spz） | 空间重排高斯核。提升 GPU 缓存局部性，运行时支持高效视锥裁剪。 | 推荐用于生产部署 |
| SOG 默认 | SOG 自动启用排序（LOD 前缀子集和 chunk 空间一致性所需）。 | SOG 始终开启 |
| `--no-sort`（仅 SOG） | 禁用排序。转换更快但丢失流式 LOD 质量（首 chunk 不再空间连贯）。 | 仅调试/测试 |

- Morton 排序使用每轴 16 位分辨率（65536 级），对 ~1km 以内场景提供充足的空间粒度。
- 排序在转换阶段增加 O(N log N) 开销，但显著提升运行时渲染性能。

</details>

<details>
<summary>大文件转换与 OOM 处理</summary>

转换大型 PLY 文件（如 >50 MB / 300 万+高斯核）时，Node.js 可能会报 `JavaScript heap out of memory`（OOM）崩溃，因为 V8 默认堆内存限制（约 2 GB）不够用。

通过 `NODE_OPTIONS` 环境变量增大堆内存限制：

```bash
# 增大到 8 GB（大文件推荐）
NODE_OPTIONS="--max-old-space-size=8192" npx 3dgs-convert ply-to-sog large-scene.ply -o output.sog

# 或 4 GB（中等文件）
NODE_OPTIONS="--max-old-space-size=4096" npx 3dgs-convert ply-to-spz large-scene.ply -o output.spz
```

| 文件大小 | 高斯核数 | 推荐堆内存 |
|----------|---------|-----------|
| < 30 MB | < 100 万 | 默认（2 GB） |
| 30–70 MB | 100 万–400 万 | 4 GB |
| > 70 MB | > 400 万 | 8 GB+ |

</details>

---

## 配置系统

漫游配置使用声明式 JSON 格式（`tour.json`），定义场景拓扑、相机参数、质量设置：

```json
{
  "version": "1.0",
  "meta": { "title": "虚拟看房", "description": "三室一厅漫游" },
  "defaults": {
    "camera": { "fov": 60, "minFov": 30, "maxFov": 90, "limitPitch": [-80, 80] },
    "transition": { "type": "fade", "duration": 800 },
    "quality": { "maxSplats": 1000000, "shDegree": 1, "resolution": 1.0 }
  },
  "scenes": {
    "kitchen": {
      "title": "厨房",
      "source": "/kitchen.spz",
      "initialView": { "yaw": 0, "pitch": 0, "fov": 60 },
      "extensions": {
        "hotspot": {
          "hotspots": [
            {
              "id": "to-living",
              "type": "scene",
              "position": [1.0, 1.5, -2.0],
              "targetScene": "living",
              "style": { "glow": true, "color": "#80a0ff", "size": 36 },
              "onHover": { "tooltip": "点击进入客厅" }
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

---

## 插件

### 使用内置插件

```typescript
import {
  createHotspotSystem,
  createCameraControls,
  createDepthOcclusionPlugin,
  createTouchGesturesPlugin,
  createSceneTransitionPlugin,
  createFullscreenPlugin,
  createLoadingIndicatorPlugin,
  createAutoRotatePlugin,
} from '@3dgs/plugins';

player.use(createHotspotSystem());
player.use(createCameraControls({ enableDamping: true }));
player.use(createLoadingIndicatorPlugin());
```

### 开发自定义插件

```typescript
import type { TourPlugin, FrameContext, TourPluginContext } from '@3dgs/core';

function createMyPlugin(): TourPlugin {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    init(ctx: TourPluginContext) {
      // ctx.player / ctx.renderer / ctx.container / ctx.sceneManager
    },
    update(frameCtx: FrameContext) {
      // frameCtx.camera / frameCtx.vpMatrix / frameCtx.size / frameCtx.deltaTime
    },
    destroy() {
      // 清理资源
    },
  };
}

player.use(createMyPlugin());
```

<details>
<summary>包 API 参考</summary>

### @3dgs/core

| 导出 | 类型 | 说明 |
|------|------|------|
| `TourPlayer` | 类 | 漫游播放器 — 帧循环管理、场景切换、插件编排、事件总线 |
| `SceneManager` | 类 | 场景注册、加载、切换、预加载 |
| `TourLoader` | 类 | 从 URL 或对象加载 TourConfig |
| `PluginSystem` | 类 | 插件注册、每帧更新、销毁管理 |
| `RendererAdapter` | 接口 | 渲染器抽象接口 |
| `DeviceTier` | 枚举 | 设备分级 — LOW / MEDIUM / HIGH / ULTRA |
| `TourConfig` | 类型 | 声明式场景图配置格式 |
| `TourPlugin` | 接口 | 插件接口 — `init` / `update` / `destroy` |
| `validateTourConfig` | 函数 | 配置验证 |

### @3dgs/renderer-three

| 导出 | 类型 | 说明 |
|------|------|------|
| `RenderManager` | 类 | WebGL2 + Spark 渲染管理器（生产就绪） |
| `WebGPURenderManager` | 类 | WebGPU 原生渲染管理器（实验性） |
| `WebGPUSortManager` | 类 | GPU compute shader 排序管理器 |
| `createRenderer` | 函数 | 异步渲染器工厂 — 自动检测 WebGPU，不可用回退 WebGL2 |
| `createRendererSync` | 函数 | 同步渲染器工厂 — 直接使用 WebGL2 |
| `detectWebGPU` | 函数 | WebGPU 能力检测 |
| `detectDeviceTier` | 函数 | 设备分级检测 |
| `SogStreamer` | 类 | SOG 流式 LOD 客户端 |
| `FrustumCulling` | 类 | Morton 空间分块视锥裁剪 |
| `SplatBufferPool` | 类 | ArrayBuffer 对象池（场景切换复用） |
| `decodeSpzInWorker` | 函数 | SPZ 格式解码器（Worker + 主线程回退） |

### @3dgs/convert

| 导出 | 说明 |
|------|------|
| `loadGaussiansFromPly(buffer, options?)` | 从 PLY 解析高斯数据 |
| `loadGaussiansFromSplat(buffer, options?)` | 从 `.splat` 反向加载为 GaussianCloud |
| `writeSplat(cloud)` | 写入 `.splat` 格式 |
| `writeSpz(cloud, options?)` | 写入 `.spz` 格式（gzip 压缩） |
| `writeSog(cloud, options?)` | 写入 `.sog` 格式（流式 LOD，v2: gzip + LOD 树 + 位置量化） |
| `pruneGaussians(cloud, options?)` | 冗余高斯核剔除 |
| `mortonSortGaussians(cloud, options?)` | Morton Code 空间排序 |
| `parsePly(buffer)` | 底层 PLY 解析器 |
| `parseSogMetadata(buffer)` | 解析 SOG 文件元数据 |
| `buildLodLevels(numSplats, numLevels, lodBase)` | 构建 LOD 层级边界（Morton 前缀子集） |
| `serializeLodTree(levels, lodBase)` | 序列化 LOD 树为二进制 |
| `deserializeLodTree(buffer)` | 从二进制反序列化 LOD 树 |

</details>

---

## 数据格式选择指南

三者的**稳态渲染 FPS 基本一致**（差异 < 5%），格式选择主要影响加载体验和 LOD 质量。

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

<details>
<summary>格式特性详细对比</summary>

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

</details>

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

### 开发环境配置

如果你在构建自定义应用（非使用本仓库 Demo），需要在开发服务器中配置 COOP/COEP 头：

<details>
<summary>Vite</summary>

```javascript
// vite.config.js
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  // preview 服务器同样需要配置
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  // Spark WASM 不能被预构建
  optimizeDeps: {
    exclude: ['@sparkjsdev/spark'],
  },
};
```

> [来源: 项目源码 — `apps/demo/vite.config.js`]

</details>

<details>
<summary>Webpack (webpack-dev-server v5)</summary>

```javascript
// webpack.config.js
module.exports = {
  devServer: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
};
```

</details>

<details>
<summary>Express / Node.js</summary>

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
```

</details>

> **缺少这些头时，`SharedArrayBuffer` 不可用，Spark 回退到单线程排序，性能显著下降。**

### 生产部署指南

缺少这些 HTTP 头时，渲染器会回退到单线程排序，导致性能显著下降。以下是常见托管平台的配置示例：

<details>
<summary>Nginx</summary>

在 `server` 或 `location` 块中添加 `add_header` 指令：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    # 跨源隔离头 (启用 SharedArrayBuffer 必须)
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;

    # 3DGS 数据文件 (.splat, .spz, .sog, .ply)
    location ~* \.(splat|spz|sog|ply)$ {
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
        add_header Cache-Control "public, max-age=31536000, immutable";
        gzip off;  # .spz 已 gzip 压缩; .sog 使用分块传输
    }

    location / {
        root /var/www/3dgs-demo;
        try_files $uri $uri/ /index.html;
    }
}
```

> **注意：** 使用 `always` 确保错误响应 (404, 500) 也携带头信息。Nginx 的 `add_header` 默认不继承外层块 — 在嵌套 `location` 块中需重复声明。

</details>

<details>
<summary>Vercel</summary>

在项目根目录创建 `vercel.json`：

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" }
      ]
    }
  ]
}
```

> **注意：** Vercel 会自动对 `.spz` 文件应用 `Content-Encoding: gzip`，无需额外压缩配置。

</details>

<details>
<summary>Netlify</summary>

在项目根目录创建 `netlify.toml`：

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Resource-Policy = "cross-origin"

# 可选：3DGS 数据文件长期缓存
[[headers]]
  for = "/*.splat"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.spz"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.sog"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

</details>

<details>
<summary>Cloudflare Pages</summary>

在构建输出目录 (通常是 `public/` 或 `dist/`) 中创建 `_headers` 文件：

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin

/*.splat
  Cache-Control: public, max-age=31536000, immutable

/*.spz
  Cache-Control: public, max-age=31536000, immutable

/*.sog
  Cache-Control: public, max-age=31536000, immutable
```

> **注意：** Cloudflare 的 Auto Minify 和 Rocket Loader 功能可能干扰 3DGS 渲染，请在 Cloudflare 控制台中为 3DGS 部署禁用这些功能。

</details>

<details>
<summary>验证方法</summary>

部署后，验证跨源隔离是否生效：

1. 打开浏览器 DevTools → 控制台
2. 执行：`self.crossOriginIsolated`
3. 应返回 `true`

如果返回 `false`：
- 检查**三个头**是否都已设置 (COOP、COEP、CORP)
- 使用 DevTools → Network → 点击任意请求 → Response Headers 验证
- 确认 CDN 或框架未覆盖 `Cross-Origin-Embedder-Policy` 为 `unsafe-none`

</details>

---

## 开发指南

<details>
<summary>展开开发指南</summary>

### 构建

```bash
pnpm build                          # 构建所有包
pnpm --filter @3dgs/core build      # 构建单个包
pnpm --filter @3dgs/core dev        # 监听模式
```

### 代码质量

```bash
pnpm typecheck       # 类型检查
pnpm test            # 单元测试 (411 个用例)
pnpm test:coverage   # 覆盖率报告
pnpm lint            # ESLint 检查
pnpm lint:fix        # 自动修复
pnpm format          # Prettier 格式化
```

### 文档站点

```bash
pnpm --filter @3dgs/docs dev        # 开发服务器 (http://localhost:5178)
pnpm --filter @3dgs/docs build      # 构建静态站点
pnpm --filter @3dgs/docs preview    # 预览构建产物
```

### CI/CD

GitHub Actions CI 流水线在每次 push / PR 时自动执行 Lint、Type Check、Unit Tests、Build、Benchmark。

</details>

---

## 常见问题

常见问题请参考 [FAQ 文档](docs/site/guide/faq.md)，涵盖部署、渲染、数据转换、插件、构建等方面。

---

## Monorepo 结构

```
3dgs/
├── packages/
│   ├── core/              # 框架无关核心 — TourPlayer、SceneManager、PluginSystem
│   ├── renderer-three/    # Three.js + Spark / WebGPU 渲染器适配层
│   ├── plugins/           # 插件包 — 热点、相机控制、深度遮挡、触摸、过渡、Shader
│   ├── convert/           # 数据转换 CLI + 编程 API
│   ├── react/             # React 适配层 — <TourViewer /> 组件
│   └── vue/               # Vue 3 适配层 — <TourViewer /> 组件
├── apps/
│   └── demo/              # 在线演示应用 (Vite + Vanilla TS)
├── examples/              # 12 个示例代码
├── docs/site/             # VitePress 文档站
├── .changeset/            # Changesets 版本管理
└── .github/               # CI/CD + Issue/PR 模板
```

| 文档 | 说明 |
|------|------|
| [文档站点](docs/site/) | VitePress 文档 — 指南、API 参考、示例 |
| [示例代码](examples/README.md) | 12 个可运行示例代码 |
| [FAQ 常见问题](docs/site/guide/faq.md) | 部署、渲染、转换、插件、构建常见问题 |
| [贡献指南](CONTRIBUTING.md) | 开发环境、分支策略、插件开发、提交规范 |

---

## 许可证

[MIT](LICENSE)
