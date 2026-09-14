# C-11: zstd 依赖引入策略 (书面调研, 待定)

> 状态: 📄 书面方案 — 依赖引入需用户决策, 不自动落地
> 日期: 2026-09-13
> 关联: C-03 SPZ v4 读写 (zstd 解压注入点已就绪)、TD-01 SH 保留

## 1. 背景

SPZ v4 (NGSP 容器) 用 zstd 压缩 6 条属性流。`spz-reader.ts` 已实现
v1-v3 (gzip) 完整读取 + v4 TOC/流切分/尺寸校验, zstd 解压器通过
`zstdDecompress` 注入点接入 (未注入时读取 v4 抛明确错误)。本文档决策
**选择哪个 zstd 库**以及**是否引入**。

## 2. 候选方案 (2026-09-13 调研)

| 方案 | 类型 | 大小 | 压缩 | 解压 | 维护状态 | 兼容性 |
|---|---|---|---|---|---|---|
| **fzstd** (101arrowz) | 纯 JS | ~8 KB | ❌ | ✅ | 2023 后基本停更 | 浏览器/Node 通用; ultra(≥20) 级别或 >32MB 输出可能失败 |
| **zstdify** (Ben Houston) | 纯 TS | ~495 KB | ✅ | ✅ | 2025 新建, Codex 生成, 上生产时间短 | 浏览器/Node 通用 |
| **@bokuweb/zstd-wasm** | WASM | ~903 KB | ✅ | ✅ | 活跃 | 需 init 异步, SIMD 加速 |
| **Node 原生 zlib zstd** | 原生 | 0 | ✅ | ✅ (Node 24+) | 内置 | Node 24+ 有 createZstdCompress/Decompress; **Node 22 无** (项目最低要求 22) |
| 不引入 | — | 0 | — | — | — | convert 只读写 v2 (gzip), 不产出 v4 |

## 3. 事实核检

- **本项目运行时的硬约束**: AGENTS.md 约定 Node >= 22。Node 22 **没有**原生
  zstd (Node 23.3+ 实验性加入, 24 稳定)。因此 **Node 原生方案不可用于
  库/CLI 的最低运行时**。
- **convert 包双环境**: `packages/convert` 既做 Node CLI 转换, 也作为
  浏览器 bundle 依赖 (renderer 的在线转换/SPZ 读取场景)。纯 JS/TS 方案
  无环境分裂; WASM 需处理初始化时序与 CORS。
- **SPZ v4 的官方压缩参数**: Niantic 的 C++ 写 v4 用 `ZSTD_CLEVEL_DEFAULT`
  (level 3), **不是 ultra**。fzstd 的 ultra(≥20)/32MB 限制在官方产出上
  **不会触发** (一个典型 garden 场景 ~100MB 压缩流 < 2GB, level 3 无风险)。
- **现有代码已完成的注入设计**: `SpzReadOptions.zstdDecompress` 按
  `(compressed, uncompressedSize) => Uint8Array` 签名设计, 与 fzstd
  `decompress(data, maxSize?)` 兼容 (fzstd 可不传 maxSize, 但传了能省
  扩容; 我们的调用传 uncompressedSize 恰好兼容)。

## 4. 推荐: 分场景双轨

### 4a. convert (Node CLI): 不引入依赖, 仅 gzip 路径

- C-03 已闭环 `writeSpzSoA` (v2 gzip) → `loadGaussiansFromSpzSoA`;
- v4 **读取**保留注入点: Node 24+ 用户可用原生 zlib 包装注入 (零依赖),
  Node 22 用户按需装 fzstd;
- CLI 不默认输出 v4 (gzip v2 体积已可观, zstd 收益 ≤20% 且增加维护面)。

**理由**: 最小依赖面 + Node 22 兼容 + 现有测试不依赖 zstd。

### 4b. renderer (浏览器): 可选依赖 fzstd 做 v4 解码

- 若产品需要直接加载外部 v4 SPZ, 引入 `fzstd` (~8KB gzip < 3KB),
  在 worker 侧 `decodeSpzToSplatData` 前注入;
- fzstd API 同步、无 WASM 加载, 与 worker 场景 (SAB/COM) 天然契合;
- 维护停止风险可控: 解压算法稳定, 8KB 纯函数库可 fork 兜底。

**理由**: 最小体积 + 同步 API + 官方 level 3 产出不触发其限制。

### 4c. 不推荐

- **zstdify**: 495KB 纯 TS 压缩+解压, 但仅 2025 年 Codex 单次生成,
  无长时间生产验证, 压缩路径性能/正确性未成熟;
- **@bokuweb/zstd-wasm**: 功能最全但 ~900KB + 异步 init, 对
  "读外部 v4" 这一低频能力过重;
- 全部方案都引入: 违反最小依赖原则。

## 5. 落地清单 (用户确认后执行)

1. `packages/renderer-three`: devDependency + peerDependency `fzstd`;
2. `spz-decoder-worker.ts`: `decodeSpzToSplatData` 检测 NGSP magic →
   动态 import fzstd 注入;
3. `packages/convert`: `loadGaussiansFromSpzSoA` v4 默认路径尝试
   `node:zlib` 原生 (Node 24+), 失败回退明确错误;
4. 新增 v4 round-trip 测试 (fzstd 压缩 → reader 解压, 用 zstdify 或
   官方 CLI 生成基准? 不需要 — 用 fzstd 自身 compress 也行, 但 fzstd
   无压缩 → 测试夹具用 Node 24 原生 zstd 生成, Node 22 条件跳过);
5. 更新 `docs/site/guide/` 格式支持矩阵。

## 6. 决策点

| 问题 | 选项 |
|---|---|
| 是否引入 zstd 支持 | A. 维持现状 (仅 v2 gzip, 零依赖) — **默认推荐**<br>B. renderer 增加 fzstd 支持 v4 解码 (轻量)<br>C. convert + renderer 全量支持 v4 (含写入, 需压缩端) |
| 若选 B/C, 压缩端选型 | fzstd (只解压, 8KB) / Node 24 原生 (仅 CLI) |

> 默认建议: **选项 A** (本里程碑不引入 zstd), v4 读取能力随
> `spz-reader.ts` 的注入点保留, 需要时按 4b 低成本接入。