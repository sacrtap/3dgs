# C-06: KSPLAT / LCC / RAD 格式适配可行性研究 (书面调研)

> 状态: 📄 书面调研 — 结论为不引入新格式读取, 维持现有 SPLAT/SPZ/SOG/PLY 支持
> 日期: 2026-09-13
> 关联: `packages/convert/src/` (格式读写)、C-09 (round-trip)、C-05 (压缩 PLY)

## 1. 背景

`packages/convert` 当前支持: PLY (含 SuperSplat 压缩 PLY)、SPLAT (.splat)、
SPZ (v1-v4, 写 v2)、SOG (v2/v3)。本调研评估社区其他压缩格式 (KSPLAT、LCC/RAD)
的适配成本与收益。

## 2. 格式调研 (2026-09-13, 公开资料)

### 2.1 KSPLAT (Mark Kellogg, GaussianSplats3D)

| 维度 | 事实 |
| --- | --- |
| 定位 | GaussianSplats3D WebGL viewer 的自定义二进制容器 (开放, 源码在仓库内) |
| 结构 | 小 header (magic + version + splat 数 + 压缩等级) + 紧凑 per-splat 记录 |
| 压缩等级 | L0: 全精度 float32 (≈ 未压缩 PLY 大小); L1: 位置/协方差 float16 + SH 量化 (4M splat ≈ 1.4GB → 150-300MB); L2: 更激进 (8-bit 整数编码, ≈ 7×) |
| 互操作 | 格式开放, 但读取需移植 GaussianSplats3D 的 `loadKSplat` 解析器 (PlaneSort 路径耦合) |
| SH 支持 | 是 (SH 系数量化) |

### 2.2 LCC / RAD (Luma AI)

| 维度 | 事实 |
| --- | --- |
| 定位 | Luma AI 的专有压缩编解码, 输出 `.rad` (radiance) 单文件 |
| 结构 | 量化 + 熵编码的二进制流; 含 position/covariance/color/SH 全量数据 |
| 压缩比 | 单对象 ≈ 8MB, 全场景 ≈ 20MB (厂商宣传); 即时流式 |
| 互操作 | **专有, 无公开规范** — 解码依赖 Luma SDK/API (闭源) |
| 授权 | 厂商云服务输出, SDK 授权条款约束再分发 |

### 2.3 对照: 本仓库已有格式的压缩能力

| 格式 | 压缩 | 体积量级 (4M splat 参考) | SH |
| --- | --- | --- | --- |
| PLY (原始) | 无 | ~1.4 GB | 是 |
| 压缩 PLY (C-05, SuperSplat) | 量化 (位置 32bit 打包 / 颜色 8bit) | 数十 MB 级 | 是 (C-05 已含 SH 量化) |
| SPZ v2 (gzip) | 整流 gzip + 量化 | 100-300 MB | 是 (TD-01/SPZ 布局) |
| SOG v3 (C-04) | 量化 + 可选 gzip | 百 MB 级 | 是 (SH overlay) |

## 3. 适配成本与收益对比

| 格式 | 适配工作量 | 收益 | 结论 |
| --- | --- | --- | --- |
| KSPLAT | 中: 移植解析器 (布局简单, 但压缩等级多, 测试面广) | 低-中: 生态工具 (GaussianSplats3D) 互换 | 可选 (P3), 非高优 |
| LCC/RAD | 高: 专有格式需逆向或 SDK 依赖 (授权 + 闭源 + 体积) | 低: 仅 Luma 生态互通 | ❌ 不引入 |
| 维持现状 | 0 | 已有压缩 PLY/SPZ/SOG 覆盖主要需求 | ✅ |

**关键判断**:
1. 本仓库自产格式 (SPZ v2 gzip + SOG v3 + 压缩 PLY) 已覆盖"体积 vs 画质"的主流
   需求区间, KSPLAT/LCC 的额外压缩比不带来量级差异。
2. LCC/RAD 是**专有格式**, 引入意味着闭源 SDK 依赖 + 授权风险, 与仓库
   "零运行时依赖"原则 (C-11 同款决策) 冲突。
3. KSPLAT 的价值是 GaussianSplats3D 生态互操作 — 该 viewer 与本项目定位重叠,
   互换需求弱。

## 4. 结论与建议

1. **不引入 LCC/RAD**: 专有 + 闭源 SDK + 授权风险, 收益低。
2. **KSPLAT 列为 P3 可选**: 若后续出现明确需求 (用户上传 KSPLAT 场景), 读取端
   可低成本移植 (格式开放); 写入端无必要。
3. **互操作焦点放在 SuperSplat 生态**: 压缩 PLY (C-05) 已是社区通用互操作格式,
   round-trip 套件 (C-09) 守护其正确性 — 继续沿此方向投入。

## 5. 备注

本调研基于 2026-09-13 公开资料 (厂商文档/社区文章); 专有格式 (LCC/RAD) 的
内部布局无法核验, 判断以"是否开放可移植"为准, 不依赖具体字节布局。
