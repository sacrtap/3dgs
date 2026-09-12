# C-08: Web Worker / WASM 转换路径评估 (书面方案)

> 状态: 📄 书面方案 — 依赖选择与架构决策需用户确认后落地
> 日期: 2026-09-13
> 关联: C-01 (SoA 全链路)、C-03 (SPZ v4/zstd)、C-11 (zstd 策略)、TD-34 (COOP/COEP 真机验证)

## 1. 背景与现状

当前转换架构:

- **convert 包 (Node CLI)**: 主线程同步解析 → SoA 写入。大文件 (≥5M splat) 在
  Node 堆内完成 (`--max-old-space-size=4096` 冒烟通过)。
- **renderer 加载路径**: `fetch` 字节 → (WebGL: Spark 直吃字节; WebGPU: 主线程
  decode 到 SoA)。SPZ 的 gzip 解压在 **Worker 内** (`spz-decoder-worker.ts`,
  TD-01 已支持 `decodeSpzToSplatData`)。
- **未落地**: SPZ v4 zstd 解压 (C-03 注入点保留, 默认 C-11 选项 A 不引入依赖);
  PLY→SPLAT/SPZ 的**浏览器端在线转换** (convert 包未打包为 web bundle 消费)。

## 2. 转换路径拆分: 哪里值得 Worker / WASM

| 环节 | 现状位置 | Worker 化收益 | WASM 化收益 |
| --- | --- | --- | --- |
| gzip 解压 (SPZ v2) | Worker (已) | ✅ 已做 | 低 (zlib 已够快) |
| zstd 解压 (SPZ v4) | 注入点 (未接入) | ✅ 解压放 Worker 不卡 UI | 中 (fzstd 纯 JS vs wasm 性能, 见 C-11) |
| PLY 解析 (浏览器在线转换) | 无 (仅 Node CLI) | ✅ 结构性 | 中低 (纯数值解析, JS 可优化) |
| 排序/裁剪 (转换期) | Node CLI 主线程 | 无 (Node 无 UI 线程问题) | 低 |
| SoA 打包 | Node CLI 主线程 | 无 | 低 |

**关键结论**: 唯一值得 Worker 化的是**浏览器端在线转换** (若产品需要网页上传
PLY → 转换 → 加载)。SPZ 解压已在 Worker; gzip/zstd 均为解压场景。

## 3. Worker 方案设计

```
浏览器端在线转换 (若立项):
  main thread: fetch PLY → postMessage(ArrayBuffer | 流式 chunk)
  worker:      逐 chunk 解析 (C-02 分块思路复用) → 构建 SoA → 回传
               [可选] 转换到 SPZ v2 (gzip 在 worker 内, 不卡 UI)
```

- **传输**: 大文件用 `transferable` (ArrayBuffer 零拷贝) 或 SAB (需 COOP/COEP,
  关联 TD-34 §5); 无 COOP/COEP 时 postMessage 复制是保底。
- **chunk 化**: 复用 `PLY_STREAM_CHUNK_ROWS` (1<<16) 分块, 与 C-02 流式解析一致;
  进度回调复用 `load:progress` 事件契约 (TD-03+R-05 已定义)。

## 4. WASM 方案评估

| 场景 | WASM 收益 | 结论 |
| --- | --- | --- |
| zstd 解压 | fzstd 纯 JS 8KB 已覆盖 (官方 level 3) | 不引入 (C-11 选项 A) |
| PLY 解析 | JS 按 float 数组解析已达 ~百 MB/s 量级; wasm 收益 <2× | 不引入 |
| 压缩/转码 | convert CLI 是 Node 场景, 无 UI 阻塞问题 | 不引入 |

**结论**: 无 WASM 落地需求。现有 JS 路径 (worker + 分块) 已满足性能与体验;
引入 WASM 增加构建链复杂度 (wasm-pack/emscripten) 与包体积, 违反 C-11 同款
"零依赖优先"原则。

## 5. 依赖与可行性结论

1. **Worker**: 已部分落地 (SPZ 解码); 浏览器在线转换功能未立项 — 若立项,
   按 §3 设计实现, **无需新依赖** (原生 Worker + transferable)。
2. **WASM**: 不引入。评估表 (§4) 记录为决策依据, 防止未来无依据引入。
3. **SAB/COOP-COEP**: 仅当浏览器在线转换 + 大文件流式场景才需要; 无 COOP/COEP
   部署下用 postMessage 复制保底 (TD-34 §5 已记录验证点)。

## 6. 结论

- 维持现状: SPZ 解码在 Worker, 转换 CLI 在 Node 主线程。
- 浏览器在线转换 = 未来功能立项, 按 §3 设计 (零新依赖)。
- WASM 路径关闭, 记录评估理由。

## 7. 备注

本文档为架构决策记录; 不产生代码变更。若立项在线转换, 验收以 C-09 round-trip
套件在 Worker 环境复用为准 (vitest 可设 `@vitest-environment jsdom` + mock Worker)。