# @3dgs/core

3DGS 渲染引擎核心 — 框架无关的 TourPlayer、SceneManager、PluginSystem。

## 安装

```bash
npm install @3dgs/core
```

## 概述

`@3dgs/core` 提供渲染引擎无关的核心抽象层：

- **TourPlayer** — 漫游播放器，管理场景切换、导览路径回放
- **SceneManager** — 场景管理器，加载/卸载 3DGS 场景
- **PluginSystem** — 插件系统，支持热插拔式功能扩展
- **RendererAdapter** — 渲染器适配接口，可对接任意渲染后端

## 许可证

[MIT](./LICENSE)
