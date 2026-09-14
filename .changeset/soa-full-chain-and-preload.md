---
'@3dgs/core': minor
'@3dgs/convert': minor
'@3dgs/renderer-three': minor
'@3dgs/plugins': minor
'@3dgs/react': patch
'@3dgs/vue': patch
---

核心链路重构与预加载支持

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
