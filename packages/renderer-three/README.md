# @3dgs/renderer-three

Three.js 渲染器适配层 — 使用 [@sparkjsdev/spark](https://github.com/sparkjsdev/spark) 渲染 3DGS。

## 安装

```bash
npm install @3dgs/renderer-three
```

## 概述

`@3dgs/renderer-three` 是 `@3dgs/core` 的 Three.js 渲染后端实现：

- **RenderManager** — 封装 Spark 渲染器，支持 PLY/SPLAT/SPZ/SOG 格式加载
- **设备分级** — 自动检测 GPU 性能，适配渲染参数 (LOD/分辨率/splat 截断)
- **自适应分辨率** — 根据 FPS 动态调整渲染分辨率
- **SOG 流式加载** — 分块渐进式加载，首帧快速渲染
- **Shader 注入** — 运行时向渲染管线注入自定义 GLSL 代码

## 依赖

需安装 peerDependencies：

```bash
npm install three @sparkjsdev/spark
```

## 许可证

[MIT](./LICENSE)
