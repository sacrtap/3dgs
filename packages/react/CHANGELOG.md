# @3dgs/react

## 0.1.3

### Patch Changes

- e73ab1b: 核心链路重构与预加载支持

  **core**
  - 预加载端到端支持: `SceneInstance` 新增 `preloading` 字段, 消除预加载类型断言
  - 统计事件与 JSON Schema 校验落地

  **convert**
  - SoA (结构体数组) 全链路转换管线
  - SPZ v1-v4 读取、SOG v3 写入、压缩 PLY 支持
  - 完整 round-trip 测试套件

  **renderer-three**
  - WebGL/WebGPU 双后端共享模块抽取 (fetch/降采样/SOG 加载)
  - SOG v3 流式传输 + WebGPU SH (球谐) 保留
  - SPZ 解码/WebGPU 检测类型重新导出整理 (公共 API 不变)

  **plugins**
  - Shader 注入 presets 扩展 + 触摸手势测试补强

  **react / vue**
  - 预加载与 initialScene 时序行为增强 (接口兼容)

- Updated dependencies [e73ab1b]
  - @3dgs/core@0.2.0

## 0.1.2

### Patch Changes

- 7f59cf4: feat: 新增空间媒体嵌入(图像/视频无缝融合)、热点点击弹出、Shader 预设库; 渲染正确性与性能优化(WebGPU 索引管线/restore 循环/超时保护/隐藏暂停/高分屏与 iPad 识别); convert 新增 SuperSplat 快路径与 Buffer 安全切片; core/react 修复渲染器切换帧回调与双加载。
- Updated dependencies [7f59cf4]
  - @3dgs/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [b80219d]
  - @3dgs/core@0.1.1
