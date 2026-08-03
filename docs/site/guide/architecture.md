# 架构设计

## 五层架构

```
┌──────────────────────────────────────────────────────────┐
│                    应用层 (Application)                    │
│              apps/demo · 用户业务代码                       │
├──────────────────────────────────────────────────────────┤
│                  框架适配层 (Adapter)                      │
│         @3dgs/react · @3dgs/vue                           │
├──────────────────────────────────────────────────────────┤
│                    插件层 (Plugin)                         │
│              @3dgs/plugins                                │
│  HotspotSystem · SceneTransition · DepthOcclusion         │
│  TouchGestures · Fullscreen · LoadingIndicator            │
│  AutoRotate · ShaderInjection                             │
├──────────────────────────────────────────────────────────┤
│                    核心层 (Core)                           │
│                    @3dgs/core                             │
│  TourPlayer · SceneManager · PluginSystem                 │
│  TourConfig · TourLoader · RendererAdapter                │
├──────────────────────────────────────────────────────────┤
│                   渲染层 (Renderer)                        │
│              @3dgs/renderer-three                         │
│  RenderManager (Spark + Three.js)                         │
│  DragLookControls · DeviceTier · AdaptiveResolution       │
│  SogStreamer · WebGPUDetector                             │
└──────────────────────────────────────────────────────────┘
```

## 核心设计原则

### 1. 渲染器抽象

`RendererAdapter` 接口将核心层与具体渲染后端解耦。当前使用 Three.js + Spark 实现，
未来可替换为 WebGPU 原生实现。

### 2. 单一 RAF 循环

所有动画、插件更新、渲染都挂载在渲染器管理的单一 `requestAnimationFrame` 循环上，
避免多 RAF 导致的帧率抖动和调度冲突。

### 3. 零依赖核心

`@3dgs/core` 不依赖任何运行时库（three.js、Spark 等），确保核心层稳定且可独立使用。

### 4. 插件系统

所有领域功能（热点、过渡、触摸等）通过插件系统扩展，核心层仅提供生命周期管理
（`init` → `update` → `destroy`）。

### 5. 声明式配置

通过 JSON 配置文件定义完整的漫游体验，支持从 URL 或对象加载。
