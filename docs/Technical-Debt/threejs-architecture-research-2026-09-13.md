# 3DGS Web 渲染引擎技术架构研究报告

## 1. 执行摘要

Three.js 的最新 npm 版本为 `0.186.0`，对应的 `r186` 提交发布于 2026-09-08。[^1][^2] 当前项目的 lockfile 实际安装 `three@0.185.1`，`packages/renderer-three/package.json` 的 peer 依赖为 `^0.185.0`，距离最新版只差一个小版本。Three.js 已经同时维护 WebGL 和 WebGPU 两条渲染路径，并提供官方的高斯泼溅 PLY 加载器、WebGPU 高斯泼溅示例和 `KHR_gaussian_splatting` glTF 扩展支持，但并未提供开箱即用的漫游框架、流式加载、热点系统和插件体系。[^3][^4][^5]

当前项目是 6 个可发布包组成的 pnpm Monorepo：`core`、`renderer-three`、`convert`、`plugins`、`react`、`vue`。生产渲染路径为 WebGL2 + Spark，实验性路径为自研 WebGPU/WGSL 渲染管理器。2026-09-13 在本机验证结果为 30 个测试文件、567 个测试用例全部通过，`pnpm typecheck` 和 `pnpm lint` 均通过。现有文档已登记 36 项技术优化项，其中 17 项已在 2026-09-12 轮次修复；仍有关键缺口集中在 WebGPU SPZ 球谐系数、预加载空壳、双后端重复加载逻辑、大文件内存模型、全 GPU 排序、移动端真机验证和渲染器大文件拆分。

本报告建议的最优架构是：保留 `@3dgs/core` 零运行时依赖和框架无关设计；将格式路由、下载进度、降采样、LOD 元数据、预加载和统计事件下沉到共享渲染层；WebGL2 + Spark 继续作为生产后端；WebGPU 自研渲染器保持实验状态，在完成 SPZ SH、空间裁剪、全 GPU 排序和官方 `WebGPURenderer` 评估后再决定是否转正。Three.js 升级到 `0.186.0`、Spark 升级到 `2.2.0` 应作为第一阶段事项，并配合完整基准回归。

项目的核心竞争力可以概括为四件事：开箱即用、性能强劲、插件生态丰富、易于拓展。当前代码已经具备大部分能力底座，但预加载、WebGPU 画质一致性、测试覆盖和真机性能基线仍是需要补齐的短板。

第 7 节新增数据转换专项调研，对比 SPZ v4、SOG、压缩 PLY、SuperSplat、Spark build-lod 和 GaussianSplats3D 的能力，并给出 C-01 至 C-11 数据转换优化项与分阶段执行计划。

## 2. 研究方法与证据基线

研究基于四类证据：当前 worktree 的源码和文档、CodeGraph 调用关系、本机质量门禁结果、以及 npm/GitHub 上的最新版本和开源项目信息。所有外部事实均以访问日期 2026-09-13 可获得的信息为准。

本机验证结果：

| 检查项                                                 | 结果                              |
| ------------------------------------------------------ | --------------------------------- |
| `pnpm test`                                            | 30 个测试文件，567 个用例全部通过 |
| `pnpm typecheck`                                       | 通过                              |
| `pnpm lint`                                            | 0 错误                            |
| `packages/renderer-three/src/index.ts`                 | 1501 行                           |
| `packages/renderer-three/src/webgpu-render-manager.ts` | 1807 行                           |
| 测试文件数量                                           | 30                                |

用户额外指定的微信文章链接最初无法在浏览器环境访问；用户后续提供了同一文章的本地 HTML 文件，正文已读取并纳入第 6 节补充分析。原文链接仍在参考来源中保留。[^6][^28]

## 3. Three.js 最新版本能力与稳定性

### 3.1 版本事实

| 事实               | 值                                                                        |
| ------------------ | ------------------------------------------------------------------------- |
| npm latest         | `three@0.186.0`                                                           |
| `r186` 提交        | 2026-09-08                                                                |
| 当前项目 lockfile  | `three@0.185.1`                                                           |
| 当前项目 peer 依赖 | `^0.185.0`                                                                |
| 官方 README 定位   | 当前构建包含 WebGL 和 WebGPU 渲染器，SVG 和 CSS3D 渲染器以 addon 形式提供 |

Three.js 的官方 README 明确描述当前构建只包含 WebGL 和 WebGPU 渲染器，SVG 和 CSS3D 渲染器作为 addon 存在。[^1] 这意味着项目在升级到 `0.186.0` 后仍可获得稳定的 WebGL 主路径，同时保留 WebGPU 演进能力。

### 3.2 WebGPU 与 TSL 能力

Three.js 文档将 `WebGPURenderer` 定位为 `WebGLRenderer` 的新替代品。`WebGPURenderer` 默认尝试 WebGPU 后端，不支持 WebGPU 时回退到 WebGL2 后端。[^3] 包入口还提供 `three/webgpu` 和 `three/tsl`，说明 WebGPU 渲染器和 Three Shading Language 已成为独立的一等入口。[^7]

`docs/llms.txt` 中的选型建议指出，需要 TSL 自定义着色器或材质时应使用 `WebGPURenderer`。[^8] 对当前项目而言，这意味着未来如果迁移 WebGPU 路径，可以将自研 WGSL 注入和管线管理逐步替换为 TSL 节点系统，但需要先验证 Spark 的 WebGL 路径和 Three.js 官方 WebGPU 路径在性能、兼容性和维护成本上的实际差异。

### 3.3 高斯泼溅能力

Three.js 官方仓库已经包含多项高斯泼溅能力：

| 能力                | 证据                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| WebGPU 高斯泼溅示例 | `examples/webgpu_gaussian_splat.html`                                  |
| PLY 加载器          | `GaussianSplatPLYLoader`，可扫描 `f_rest_N` 属性并自动推断 SH degree   |
| glTF 扩展           | `GLTFGaussianSplatLoaderExtension` 支持 `KHR_gaussian_splatting`       |
| r186 原生体系       | `GaussianSplat` 网格、SPZ/PLY/KSPLAT/SPLAT/glTF 五个加载器、TSL 双后端 |

这些能力证明 Three.js 生态正在把高斯泼溅标准化为通用 3D 场景资产，而不只是单一演示。项目可以复用 Three.js 官方加载器和格式互操作，把差异化集中在漫游、流式、LOD、设备分级和插件能力上。

用户提供的微信文章页签标题同样指向“Three.js r186：高斯泼溅正式成为引擎原生公民”这一结论；正文已通过本地 HTML 读取，详细补充分析见第 6 节。[^6][^28]

### 3.4 稳定性与风险

Three.js 的 WebGLRenderer 是成熟稳定路径；WebGPURenderer 处于快速演进阶段，文档中已经出现“某些 addon 只能用于 WebGLRenderer，另一些只能用于 WebGPURenderer”的分化。[^9] 例如 Sky 和 CSM 都给出了 WebGL 与 WebGPU 两套实现。因此自研 WebGPU 渲染器不应直接依赖过于激进的内部 API，而应通过渲染器适配层隔离升级风险。

当前 Spark 2.1.0 的 devDependencies 使用 `three@^0.180.0`，而项目使用 `three@^0.185.0`，版本已经出现错位。[^10] Spark 最新 npm 版本为 `2.2.0`，发布时间为 2026-09-11，是升级到 Three.js 0.186 时最值得先执行的兼容性验证。[^11]

## 4. 当前项目实际现状

### 4.1 包架构

| 包                     | 职责                                                                | 现状评价                               |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `@3dgs/core`           | TourPlayer、SceneManager、PluginSystem、RendererAdapter、事件总线   | 设计清晰，零运行时依赖，是分层基础     |
| `@3dgs/renderer-three` | WebGL2 + Spark 生产后端、WebGPU 实验后端、格式路由、LOD、排序、裁剪 | 能力丰富，但两个渲染管理器重复度较高   |
| `@3dgs/convert`        | PLY/SPLAT 读取，SPLAT/SPZ/SOG 写入，CLI                             | 功能完整，AoS 内存模型限制大文件       |
| `@3dgs/plugins`        | 热点、场景过渡、相机、触摸、全屏、加载、自动旋转、Shader 注入等     | 已有 10 个子路径导出，测试覆盖仍不均衡 |
| `@3dgs/react`          | `TourViewer` React 适配层                                           | 双重加载已修复，无组件测试             |
| `@3dgs/vue`            | `TourViewer` Vue 适配层                                             | 首次挂载守卫已修复，无组件测试         |

### 4.2 渲染与格式现状

渲染器工厂 `createRenderer()` 默认优先选择 WebGPU 后端，不可用时回退 WebGL2 + Spark。[^12] WebGL 路径通过 Spark 渲染，WebGPU 路径使用自研 WGSL 管线、GPU compute 距离计算、CPU 排序回读和视锥裁剪。

当前支持的格式和流式能力：

| 格式                | 状态                                                              |
| ------------------- | ----------------------------------------------------------------- |
| PLY                 | convert 支持读取和写入；渲染器通过 Spark/加载器消费               |
| SPLAT               | convert 与渲染器支持                                              |
| SPZ                 | convert 输出 SPZ v2；WebGL 路径保留 SH，WebGPU 路径仍存在 SH 丢失 |
| SOG v2              | convert 输出，渲染器支持并行分块、gzip、LOD 树                    |
| SOG v3              | 常量存在，读取端明确报错，写入端仍写 v2                           |
| SOG compact 29 字节 | 读取端已实现 positionQuant 反量化                                 |

关键代码证据：

- WebGPU `loadSceneWithSpz()` 仍调用 `decodeSpzInWorker()`，输出 `.splat` 布局，导致 WebGPU 后端 SPZ 路径丢失 SH。[^13]
- `SceneManager.preload()` 只更新状态，没有调用 `RendererAdapter.preloadScene()`，预加载仍是空壳。[^14]
- WebGPU `performFrustumCull()` 仍按 splat 逐点测试，未复用基于 SpatialGrid 的 `FrustumCulling` 批量裁剪。[^15]
- `WebGPUSortManager.sort()` 仍将 GPU 距离结果回读 CPU 后排序，存在 GPU 到 CPU 同步和回写开销。[^16]
- convert 的 `GaussianCloud` 主路径仍使用 AoS 对象数组，`toSoA()` 主要在测试路径使用，大文件转换内存峰值偏高。[^17]

### 4.3 已落地性能手段

项目已经实现设备分级、最大 splat 数量限制、LOD 质量分级、自适应分辨率、SOG 流式首帧、并行 chunk 加载、Worker 拼接、排序节流、注视点渲染、`blurAmount`、`minAlpha`、`focalAdjustment`、空间分块裁剪、BufferPool、隐藏页面暂停和 DPR 分档。[^18]

历史基准显示 SOG 路径经过降采样和 LOD 修复后，Garden 场景 P50 从 2.0 FPS 恢复到 60.0 FPS，Kitchen 场景恢复到 54.1 FPS。[^19] 这些数据说明性能优化的方向有效，但需要在新版本升级后重新建立基线。

## 5. 同类开源方案对比

### 5.1 对比表

| 项目                     | 技术底座                | 格式                                               | 流式/LOD                     | 漫游与插件 | 对本项目的参考价值                      |
| ------------------------ | ----------------------- | -------------------------------------------------- | ---------------------------- | ---------- | --------------------------------------- |
| three.js 官方            | WebGL、WebGPU、TSL      | r186 原生 GaussianSplat、SPZ/PLY/KSPLAT/SPLAT/glTF | 无内置流式漫游               | 无         | 提供标准加载器、渲染器和生态互操作      |
| Spark                    | WebGL2、WASM、Three.js  | PLY、SPZ、SPLAT、KSPLAT、SOG                       | LOD、Worker 排序、动态 splat | 无         | 当前生产渲染核心，可继续升级 [^26]      |
| SuperSplat               | PlayCanvas 编辑器工具链 | PLY、SPLAT、SOG、SPZ、LCC                          | 编辑器级工具                 | 无         | 格式导出、压缩和 SPZ 版本参考 [^21]     |
| antimatter15/splat       | WebGL 单页查看器        | SPLAT/PLY                                          | 无                           | 无         | 最小化实现参考，展示性能下限 [^22]      |
| GaussianSplats3D         | Three.js                | PLY、SPLAT、KSPLAT、压缩格式                       | LOD、动态场景                | 无         | 基于 Three.js 的加载/渲染功能参考 [^23] |
| web-splat                | WebGPU、Rust/WASM       | PLY                                                | 无漫游体系                   | 无         | WebGPU 高性能渲染参考 [^24]             |
| fynv/web_gaussian_splats | WebGL/Three.js          | 多种 splat 格式                                    | 渐进加载参考                 | 无         | 渐进加载和兼容性参考 [^25]              |

### 5.2 对比结论

目前没有单一开源项目同时覆盖“开箱即用、性能强劲、插件生态丰富、易于拓展”四个维度。Three.js 提供生态底座，Spark 提供高质量 WebGL 渲染，SuperSplat 提供格式工具链，web-splat 提供 WebGPU 性能参考，但漫游框架、设备分级、热点交互、框架适配和插件系统仍是本项目已经建立且需要继续强化的差异层。

## 6. 微信文章补充分析：Three.js r186 原生高斯泼溅

### 6.1 文章核心事实

文章确认 r186 于 2026 年 9 月发布，贡献者 Ben Houston 通过三个 PR 将完整渲染器和加载器合入 dev 分支。官方实现的核心是原生 `GaussianSplat` 网格类型、五个格式加载器，以及基于 TSL 的 `NodeMaterial`，目标是用同一份着色器代码同时支持 WebGPU 和 WebGL 后端。[^28]

数据层被简化为普通 `BufferGeometry`：`position`、6 个浮点的 covariance 上三角、`rgba8` 颜色，不再定义专门的 splat 数据类。加载器层把不同源格式统一转换到该几何体结构；渲染器层继承 `THREE.Mesh`，因此变换、可见性、射线检测和后处理可以与普通 Three.js 对象统一使用。排序使用计数排序思路，在 GPU 上执行重置、直方图、前缀和、散列四个计算 pass，相机跨过阈值时才重排，WebGL 后端提供同样四步的 CPU 回退。[^28]

文章还明确指出三个工程边界：原生实现支持 SH1 至 SH3，并通过 pre-pass 避免每个实例化四边形重复计算 SH；SPZ v4 使用 zstd 压缩，是官方推荐的传输格式；官方实现目前面向单个物体或房间尺度，没有 LOD、流式传输和空间分割裁剪，城市级或多 GB splat 云仍需切片或缩减。[^28]

### 6.2 对当前项目的架构启示

| r186 事实                                            | 当前项目对应现状                                         | 建议动作                                                           |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| 原生 `GaussianSplat` 直接复用 BufferGeometry 和 Mesh | 当前使用 Spark 独立渲染器和自研 WGSL 管线                | 将官方几何体结构纳入共享格式层，作为未来统一中间表示               |
| TSL 使同一份 shader 运行在 WebGPU 和 WebGL           | 当前 WebGL 用 GLSL 注入，WebGPU 用 WGSL，维护两套 shader | 在 WebGPU 转正评估中对比官方 TSL 路径与自研 WGSL 路径              |
| GPU 计数排序为 O(N) 近似排序，模块可复用             | 当前 WebGPU 路径使用 GPU 距离计算 + CPU 回读排序         | 用官方 CountingSort 思路做基准对比，评估全 GPU 排序收益            |
| SH1-SH3 与 SH pre-pass 被官方明确实现                | WebGPU SPZ 路径仍丢 SH                                   | TD-01 优先级进一步确认，需在 WebGPU 转正前修复                     |
| SPZ v4 使用 zstd，兼容 v1-v3                         | 当前 convert 输出 SPZ v2，无 zstd 支持                   | R-04 扩展为支持 SPZ v4，至少提供读取和互操作测试                   |
| 官方暂无 LOD、流式、空间裁剪                         | 当前已有 SOG 流式、LOD 树、FrustumCulling                | 大场景能力仍是项目差异化核心，不应被官方基础实现替代               |
| r186 包含 7 个 breaking change                       | 当前项目使用 three 0.185.x                               | 升级时加入 `Object3D.dispose()`、`SimplifyModifier` 异步等回归清单 |

### 6.3 更新后的能力对照

| 能力                    | Three.js r186 官方 | 当前项目                             |
| ----------------------- | ------------------ | ------------------------------------ |
| 原生 GaussianSplat 网格 | 有                 | 无，使用 Spark/WGSL 自定义路径       |
| SPZ v4 zstd             | 有                 | 无，convert 输出 SPZ v2              |
| SOG 流式与 LOD          | 无                 | 有，SOG v2 + LOD 树                  |
| 空间分割裁剪            | 无                 | 有，WebGL SpatialGrid；WebGPU 待统一 |
| 漫游/插件/React/Vue     | 无                 | 有，完整 TourPlayer 与插件体系       |
| 格式加载器              | 五个官方加载器     | 自有格式路由 + Spark 原生加载        |

## 7. 数据转换能力深度调研与当前现状分析

### 7.1 外部格式与工具调研

数据转换专项调研聚焦四个方向：压缩与容器格式、离线 LOD/流式格式、编辑器工具链、以及可复用的加载/转换实现。调研对象包括 Niantic SPZ、PlayCanvas SOG、压缩 PLY、SuperSplat、Spark build-lod、GaussianSplats3D 和 Three.js r186 官方加载器。[^28][^29][^30][^31][^32][^33]

主要事实：

| 格式/工具        | 能力                                                                                        | 参考价值                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Niantic SPZ      | v1-v3 兼容，v4 使用 zstd 压缩属性流和 TOC；Three.js r186 文章推荐 SPZ v4                    | 当前 convert 只输出 SPZ v2，需要补齐 v4 或至少建立互操作测试 |
| PlayCanvas SOG   | Morton 排序、分块、流式 LOD；SOG v2 已开源并被 Spark 支持                                   | 当前 SOG v2 的基础接近，但 SOG v3 SH overlay 未闭环          |
| 压缩 PLY         | SuperSplat 可导出压缩 PLY；Spark 与 GaussianSplats3D 可读取                                 | 当前只支持读取 SuperSplat 打包 PLY，不输出压缩 PLY           |
| SuperSplat       | 支持 PLY/SPLAT/SOG/SPZ/LCC/LCC2 等格式的编辑与导出                                          | LCC/LCC2 是编辑器容器格式，适合作为互操作测试目标 [^35]      |
| Spark build-lod  | 支持 PLY（含压缩）、SPZ、SPLAT、KSPLAT、SOG、zip/SOGS、RAD/RADC；提供 tiny-lod 与 bhatt-lod | 大场景 LOD 和流式格式的重要参照，RAD/RADC 适合后续评估       |
| GaussianSplats3D | 提供 KSPLAT 压缩格式和 PlayCanvas 压缩 PLY 解析器                                           | KSPLAT 可作为轻量格式适配参考                                |

### 7.2 当前 convert 现状

当前 `@3dgs/convert` 已经覆盖 PLY/SPLAT 输入，以及 SPLAT/SPZ/SOG 输出，CLI 支持 `ply-to-splat`、`ply-to-spz`、`ply-to-sog`、`splat-to-spz`、`splat-to-sog`、`batch`、`generate-tour` 和 `info`。[^34]

已实现的能力：

- SuperSplat 打包 PLY 快路径，Garden 文件解析实测从 34.8s 降到 7.8s，约 4.5 倍提速。
- SPZ v2 写入，保留 SH 0-3。
- SOG v2 写入，支持 gzip、Morton 排序、LOD 树、compact 29 字节 chunk、SH DC 追加。
- prune、contributionCutoff、Morton sort 等数据清理与空间重排能力。
- 质量对比验证：源文件到 SPLAT 产物没有系统性偏差，误差落在 8-bit 量化极限内。

主要缺口：

| 缺口     | 现状证据                                                            |
| -------- | ------------------------------------------------------------------- |
| 内存模型 | `GaussianCloud` 主路径仍使用 AoS 对象数组，`toSoA()` 未接入生产管线 |
| 读取方式 | PLY 仍整文件读入内存，缺少流式解析                                  |
| SPZ 版本 | 写入器固定 SPZ v2 + gzip，无 zstd、无 SPZ v4 TOC 属性流             |
| SOG 版本 | SOG v3 常量存在但写入端仍写 v2，读取端对 v3 明确报错                |
| 输出格式 | 不支持压缩 PLY、KSPLAT、LCC/LCC2、RAD/RADC                          |
| 运行形态 | 只有 Node CLI，无 Web Worker/WASM 转换路径                          |
| 质量保障 | 缺少跨格式 round-trip 基准文件和自动质量回归套件                    |

### 7.3 能力矩阵

| 能力                | @3dgs/convert | SuperSplat | Spark build-lod | GaussianSplats3D | Three.js r186 |
| ------------------- | ------------- | ---------- | --------------- | ---------------- | ------------- |
| 标准 PLY 读取       | 是            | 是         | 是              | 是               | 是            |
| SuperSplat 打包 PLY | 读取          | 读写       | 读取            | 读取             | 读取          |
| 压缩 PLY 输出       | 否            | 是         | 否              | 否               | 否            |
| SPLAT               | 读写          | 读写       | 读取            | 读取             | 读取          |
| SPZ v2              | 写            | 读写       | 读取            | 读取             | 读取          |
| SPZ v4 zstd         | 否            | 导出       | 读取            | 待验证           | 官方加载器    |
| SOG v2              | 读写          | 导出       | 读取            | 否               | 否            |
| SOG v3              | 未闭环        | 待验证     | 待验证          | 否               | 否            |
| LCC/LCC2            | 否            | 是         | 否              | 否               | 否            |
| RAD/RADC            | 否            | 否         | 是              | 否               | 否            |
| KSPLAT              | 否            | 否         | 读取            | 读写             | 否            |
| 离线 LOD 构建       | 简单前缀      | 导出 LOD   | tiny/bhatt      | 有限             | 否            |

### 7.4 差距分析

压缩能力差距集中在 SPZ v4 和压缩 PLY：SPZ v4 的 zstd 属性流是当前生态推荐方向，当前项目仍停留在 SPZ v2 gzip；压缩 PLY 能兼容 SuperSplat 与 Spark 的工作流，当前只读不写。规模能力差距集中在内存和流式：PLY 全量解析加 AoS 中间模型让 500 万以上 splat 的转换依赖超大 Node.js 堆，缺少类似 Spark build-lod 的离线大场景工具链。格式互操作差距集中在 SOG v3、LCC/LCC2 和 RAD/RADC：这些格式决定项目能否直接接入 SuperSplat、Spark 和未来 Three.js 官方大场景工具。

### 7.5 数据转换优化项与计划

| ID   | 优化项                                                         | 优先级 | 预计成本 |
| ---- | -------------------------------------------------------------- | ------ | -------- |
| C-01 | convert 全链路接入 `GaussianCloudSoA`，解析直出列式 TypedArray | P0     | 2-3 天   |
| C-02 | PLY 流式解析，降低峰值内存                                     | P1     | 2-3 天   |
| C-03 | SPZ v4/zstd 读写与 v1-v3 兼容测试                              | P1     | 2-3 天   |
| C-04 | SOG v3 SH overlay 写入/读取闭环，评估 SOGS/zip                 | P1     | 2-3 天   |
| C-05 | 压缩 PLY 输出，与 SuperSplat/Spark 互操作                      | P2     | 2-3 天   |
| C-06 | KSPLAT/LCC/RAD 适配可行性研究                                  | P2     | 1-2 天   |
| C-07 | CLI 增加 `--max-splats` 转换期预裁剪和质量回执                 | P1     | 1-2 天   |
| C-08 | Web Worker/WASM 转换路径                                       | P2     | 3-5 天   |
| C-09 | 跨格式 round-trip 基准文件与自动质量回归套件                   | P1     | 2-3 天   |
| C-10 | batch CLI 支持 SPLAT/SPZ/SOG 输入和输出 manifest               | P2     | 1-2 天   |
| C-11 | zstd 依赖策略与浏览器兼容性验证                                | P2     | 1 天     |

执行计划：

| 阶段       | 时间       | 范围                   | 验收标准                                                                                        |
| ---------- | ---------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| 转换阶段 0 | 第 1-2 周  | C-01、C-03、C-07、C-09 | 500 万 splat 转换不再依赖超大堆；SPZ v4 可读写；`--max-splats` 产物数量确定；跨格式回归套件全绿 |
| 转换阶段 1 | 第 3-6 周  | C-02、C-04、C-05、C-11 | PLY 流式解析可用；SOG v3 闭环；压缩 PLY 与 SuperSplat 互操作；zstd 浏览器方案有结论             |
| 转换阶段 2 | 第 7-12 周 | C-06、C-08、C-10       | KSPLAT/LCC/RAD 形成适配结论；Web Worker 转换不阻塞主线程；CLI 支持多输入格式                    |

## 8. 最优技术架构整体方案

### 8.1 目标原则

1. `@3dgs/core` 保持框架无关、零运行时依赖，只定义生命周期、事件、配置、场景和渲染器接口。
2. 渲染器层拆成共享数据/格式/加载模块与两个后端适配器，后端差异只在设备能力、排序和渲染管线内。
3. WebGL2 + Spark 继续作为生产路径，WebGPU 作为 feature-gated 实验路径，直到功能与画质对齐。
4. 所有外部格式以标准格式优先，SOG/SPZ 作为自有流式与压缩优化，但保持兼容性测试。
5. 插件、React/Vue、Shader 注入、媒体嵌入等能力通过公开 API 和配置扩展，不侵入核心。

### 8.2 目标模块图

```text
Application / Demo
        |
React Adapter / Vue Adapter
        |
TourPlayer + SceneManager + PluginSystem + Event Bus
        |
RendererAdapter (公开接口)
        |
RenderManagerShared:
  SceneFormatRouter | fetchWithProgress | downsampleSplatBytes
  GaussianCloudSoA | LOD metadata | preload handle | stats events
        |
----------------------------------------
        |                               |
WebGL2 + Spark adapter          WebGPU adapter (experimental)
  SplatMesh / SparkRenderer       WGSL pipeline / WebGPUSortManager
  context restore / device tier    feature-gated factory
        |                               |
        +---------- SOG Streamer --------+
```

### 8.3 关键技术决策

| 决策 | 建议                                                                       | 理由                                                                        |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D1   | 升级 `three` 到 `0.186.0`，升级 Spark 到 `2.2.0`                           | 当前版本落后一个小版本，Spark 2.2.0 刚发布，需要先验证兼容性                |
| D2   | WebGPU 保持实验路径，补齐 SPZ SH、空间裁剪和全 GPU 排序后再评估转正        | 当前自研 WGSL 路径有维护成本和画质缺口                                      |
| D3   | 抽取共享加载/格式/降采样模块                                               | 两个渲染管理器重复约 200 行加载逻辑，是 WebGPU SPZ SH 回归的根因之一        |
| D4   | 完善 SPZ v2/v4 与 SOG v2/v3 互操作测试                                     | 官方推荐 SPZ v4，SuperSplat 已支持 SPZ 4，SOG v3 常量已在项目内但读写未闭环 |
| D5   | 增加 `RendererAdapter.preloadScene()` 与加载句柄                           | 预加载是漫游框架的核心承诺，当前为空壳                                      |
| D6   | convert 主路径接入 `GaussianCloudSoA`                                      | 大文件转换不再依赖超大 Node.js 堆                                           |
| D7   | 建立可观测性接口和基准门禁                                                 | 性能优化必须能证明生效，且防止双后端漂移                                    |
| D8   | 未来 major 版本可拆 `renderer-shared`、`renderer-webgl`、`renderer-webgpu` | 降低决策密集文件风险，但不应在当前版本做破坏性拆分                          |

## 9. 当前项目全部优化项与执行计划

### 9.1 历史优化项总表

下表合并了 `comprehensive-analysis-2026-09-12.md` 的 TD 系列条目，并基于 2026-09-13 的源码和测试结果复核状态。

| ID    | 优化项                                    | 状态                                     | 优先级 | 预计成本 |
| ----- | ----------------------------------------- | ---------------------------------------- | ------ | -------- |
| TD-01 | WebGPU SPZ 路径保留 SH                    | 待执行                                   | P0     | 1-2 天   |
| TD-02 | fly 过渡与 camera:defaults 事件落地或下线 | 已处理为 experimental 文档，完整功能可选 | P0     | 1-2 天   |
| TD-03 | 预加载端到端落地                          | 待执行                                   | P0     | 2 天     |
| TD-04 | `renderer-three/src/index.ts` 拆分        | 待执行                                   | P0     | 2-3 天   |
| TD-05 | WebGPU 渲染管理器拆分与共享               | 待执行                                   | P0     | 1-2 天   |
| TD-06 | convert 接入 SoA 数据模型                 | 待执行                                   | P1     | 2-3 天   |
| TD-07 | WebGPU parseSplatData TypedArray 直取     | 已修复                                   | P1     | 1 天     |
| TD-08 | 双后端加载/降采样/进度代码抽取            | 待执行                                   | P1     | 1 天     |
| TD-09 | WebGPU 视锥裁剪统一到 SpatialGrid         | 待执行                                   | P1     | 1 天     |
| TD-10 | React/Vue 组件测试                        | 待执行                                   | P1     | 1-2 天   |
| TD-11 | RenderManager 主流程测试                  | 待执行                                   | P1     | 2-3 天   |
| TD-12 | HotspotManager CSS transform 优化         | 已修复                                   | P1     | 1 天     |
| TD-13 | PluginSystem FrameContext 复用            | 已修复                                   | P1     | 0.5 天   |
| TD-14 | preloadScenes 使用 allSettled             | 已修复                                   | P1     | 0.5 天   |
| TD-15 | contributionCutoff quickselect            | 待执行                                   | P1     | 0.5 天   |
| TD-16 | 生成热点位置基于场景包围盒                | 已修复                                   | P1     | 0.5 天   |
| TD-17 | Vue 双重加载守卫                          | 已修复                                   | P1     | 0.5 天   |
| TD-18 | DepthOcclusion 移除 preserveDrawingBuffer | 已修复                                   | P1     | 1-2 天   |
| TD-19 | SOG v3 读写闭环                           | 部分修复，读取端已明确报错但未完整支持   | P1     | 1-2 天   |
| TD-20 | decodeSpzInWorker 标记 deprecated         | 已修复                                   | P2     | 0.5 天   |
| TD-21 | TourPlayer 事件映射类型                   | 已修复                                   | P2     | 0.5 天   |
| TD-22 | ShaderHookPoint 语义清理                  | 待执行，建议 major 版本                  | P2     | 0.5 天   |
| TD-23 | LOD 就绪事件通知                          | 已文档化，公开事件 API 可选              | P2     | 0.5 天   |
| TD-24 | BufferPool 命中率外部监控                 | 已修复                                   | P2     | 0.5 天   |
| TD-25 | Morton 16-bit 精度限制文档化              | 已修复                                   | P2     | 0.5 天   |
| TD-26 | LOD 树序列化版本化                        | 已修复                                   | P2     | 0.5 天   |
| TD-27 | DragLookControls 单元测试                 | 待执行                                   | P2     | 1 天     |
| TD-28 | TourConfig JSON Schema                    | 待执行                                   | P2     | 1 天     |
| TD-29 | AdaptiveResolution 动态恢复速率           | 已修复                                   | P2     | 0.5 天   |
| TD-30 | Hotspot innerHTML 消毒                    | 已修复                                   | P2     | 0.5 天   |
| TD-31 | WebGPU 排序全 GPU 化                      | 待执行                                   | P1     | 2-3 天   |
| TD-32 | PLY 流式解析                              | 待执行                                   | P1     | 2-3 天   |
| TD-33 | demo 代码分割                             | 待执行                                   | P1     | 0.5-1 天 |
| TD-34 | 移动端真机测试                            | 待执行                                   | P1     | 2-3 天   |
| TD-35 | camera-controls 与 LoadingIndicator 测试  | 待执行                                   | P2     | 1 天     |
| TD-36 | Fullscreen 插件测试                       | 待执行                                   | P2     | 0.5 天   |

### 9.2 历史 D/N 系列复核

较早的 `technical-optimization-plan-v2.md` 还登记了 D-01 至 D-17 和 N-01 至 N-08。多数条目已并入上表，此处单独复核状态，避免优化清单遗漏。

| ID   | 内容                             | 状态                                   |
| ---- | -------------------------------- | -------------------------------------- |
| D-01 | WebGPU 排序与裁剪索引互覆盖      | 已修复                                 |
| D-02 | SOG chunk 失败静默               | 已修复                                 |
| D-03 | CLI Buffer 池安全切片            | 已修复                                 |
| D-04 | context restore 循环完整性       | 已修复                                 |
| D-05 | React 双重加载                   | 已修复                                 |
| D-06 | loadScene Promise 与超时防护     | 已修复                                 |
| D-07 | fly/camera:defaults 无消费者     | 已处理为 experimental 文档，等价 TD-02 |
| D-08 | WebGPU SPZ 丢 SH                 | 待执行，等价 TD-01                     |
| D-09 | WebGPU 相机朝向覆盖              | 已修复                                 |
| D-10 | BufferPool 只 acquire 不 release | 已修复                                 |
| D-11 | preload 空壳                     | 待执行，等价 TD-03                     |
| D-12 | FRAGMENT_BEFORE_OUTPUT 语义漂移  | 已文档化，等价 TD-22                   |
| D-13 | 死代码/自测脚本清理              | 已处理，部分清理                       |
| D-14 | lint/typecheck/clean 跨平台脚本  | 已修复                                 |
| D-15 | 测试依赖先构建                   | 已修复                                 |
| D-16 | 双后端重复加载代码               | 待执行，等价 TD-08                     |
| D-17 | plugins 子路径导出               | 已修复                                 |
| N-01 | visibilitychange 暂停渲染        | 已修复                                 |
| N-02 | HIGH/ULTRA 档 DPR 适配           | 已修复                                 |
| N-03 | iPadOS 设备分级识别              | 已修复                                 |
| N-04 | demo 移动端视口与触摸适配        | 已修复                                 |
| N-05 | DPR 变化监听                     | 待执行                                 |
| N-06 | 加载期自适应分辨率误降           | 已修复，等价 TD-29                     |
| N-07 | prefers-reduced-motion           | 已修复                                 |
| N-08 | 移动端 context lost 真机验证     | 待执行，等价 TD-34                     |

### 9.3 新识别优化项

| ID   | 优化项                                                   | 状态   | 优先级 | 预计成本 |
| ---- | -------------------------------------------------------- | ------ | ------ | -------- |
| R-01 | 升级 Three.js 到 `0.186.0` 并跑完整回归                  | 待执行 | P0     | 1 天     |
| R-02 | 升级 Spark 到 `2.2.0` 并验证格式/排序/LOD                | 待执行 | P0     | 1-2 天   |
| R-03 | 评估官方 WebGPURenderer/TSL 替换自研 WGSL 的可行性与收益 | 待执行 | P1     | 2-3 天   |
| R-04 | SPZ v2/v4、zstd 与 SOG v2/v3 互操作测试                  | 待执行 | P1     | 2-3 天   |
| R-05 | 预加载接口和加载句柄设计                                 | 待执行 | P0     | 1-2 天   |
| R-06 | 渲染统计、池命中率和帧时间事件接口                       | 待执行 | P1     | 1 天     |
| R-07 | 基准测试纳入 CI 门禁                                     | 待执行 | P1     | 1 天     |
| R-08 | CI 增加 Windows runner 和格式读写一致性检查              | 待执行 | P2     | 1 天     |
| R-09 | 移动端真机性能基线                                       | 待执行 | P1     | 2-3 天   |
| R-10 | R3F/Three.js 生态适配示例                                | 待执行 | P2     | 2-3 天   |
| R-11 | 插件开发文档、示例和贡献模板                             | 待执行 | P2     | 2 天     |

### 9.4 执行计划

| 阶段               | 时间       | 范围                                                                        | 验收标准                                                                                                                                         |
| ------------------ | ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 阶段 0：止血与升级 | 第 1-2 周  | R-01、R-02、TD-01、TD-03、TD-08、TD-19、TD-33、R-05、C-01、C-03、C-07、C-09 | `pnpm test`、`pnpm typecheck`、`pnpm lint` 全绿；WebGPU SPZ 与 WebGL SPZ 画质一致；预加载端到端可用；demo 首屏体积下降；SPZ v4 可读写            |
| 阶段 1：性能专项   | 第 3-6 周  | TD-06、TD-09、TD-15、TD-31、TD-32、R-04、C-02、C-04、C-05、C-11             | 500 万 splat 转换可在常规 Node 堆完成；WebGPU 裁剪复杂度降到 O(G)；排序不再回读 CPU；SPZ v4/zstd 与 SOG compact 互操作测试通过；PLY 流式解析可用 |
| 阶段 2：架构治理   | 第 7-12 周 | TD-04、TD-05、R-03、R-06、R-10、TD-28、C-06、C-08、C-10                     | 两个渲染管理器主文件降到 800 行以下；共享加载模块单一实现；WebGPU 转正与否形成书面结论；统计事件有 demo 展示；KSPLAT/LCC/RAD 形成适配结论        |
| 阶段 3：生态与质量 | 持续       | TD-10、TD-11、TD-27、TD-34、TD-35、TD-36、R-07、R-08、R-09、R-11            | 核心插件和框架组件有测试；CI 跨平台绿色；移动端有真实基线；插件开发文档可让新贡献者独立完成一个插件                                              |

## 10. 核心技术竞争力与差异化

### 10.1 开箱即用

项目提供 `npm install` 后的三行嵌入、`TourViewer` React/Vue 组件、`createRenderer()` 自动后端选择、CLI 数据转换和 `tour.json` 配置体系。相比只提供渲染器或查看器的开源项目，这是最明显的产品化差异。

### 10.2 性能强劲

项目已经具备设备分级、splat 数量上限、LOD、SOG 流式、并行 chunk、Worker 拼接、自适应分辨率、注视点渲染、质量参数、空间裁剪、排序节流和 BufferPool。历史基准显示 SOG 大场景修复后的 P50 可恢复到 60 FPS，说明优化手段有效；接下来需要把同样能力补到 WebGPU 路径，并用基准门禁防止回归。

### 10.3 插件生态丰富

当前已有热点、场景过渡、相机控制、触摸手势、全屏、加载指示、自动旋转、媒体嵌入、深度遮挡和 Shader 注入等插件，并支持子路径导出。Three.js 生态中还有 react-three-fiber、drei、three-stdlib 等成熟组件库可以作为适配参考。[^27] 插件生态的下一步是类型化事件契约、JSON Schema、统一 hooks、官方示例和 R3F 适配，让第三方插件可以独立开发和发布。

### 10.4 易于拓展

`RendererAdapter`、`PluginSystem`、`TourConfig`、Shader 注入和 convert 工具链构成了扩展边界。建议把格式路由、降采样、预加载和统计事件从两个渲染器中抽到共享模块，并保持 `@3dgs/core` 零依赖，这样新增后端或新增格式时不需要修改核心层。

## 11. 风险与未决事项

WebGPU 仍处于快速演进阶段，自研 WGSL 管线需要持续跟随浏览器和驱动变化；WebGL2 + Spark 路径依赖 `SharedArrayBuffer` 和 COOP/COEP，部署环境必须正确处理跨域隔离头。[^20] Spark 的版本节奏和 Three.js 版本错位也需要通过升级和回归测试控制。SOG v3、SPZ 新版本和 SuperSplat 的格式互操作目前缺乏完整测试，应该作为格式专项处理。移动端真机测试仍是性能结论的最大不确定性来源。

## 参考来源

[^1]: npm. “three.” 访问于 2026-09-13. https://www.npmjs.com/package/three

[^2]: mrdoob/three.js. “r186 commit.” 2026-09-08. https://github.com/mrdoob/three.js/commit/148ef33ecb6d2502ff796d4554abd1549c95d519

[^3]: mrdoob/three.js. “WebGPURenderer docs.” https://github.com/mrdoob/three.js/blob/dev/docs/pages/WebGPURenderer.html.md

[^4]: mrdoob/three.js. “GaussianSplatPLYLoader docs.” https://github.com/mrdoob/three.js/blob/dev/docs/pages/GaussianSplatPLYLoader.html.md

[^5]: mrdoob/three.js. “webgpu gaussian splat example.” https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_gaussian_splat.html

[^6]: 微信文章. “Three.js r186：高斯泼溅正式成为引擎原生公民，三行代码渲染一个Splat.” 访问于 2026-09-13. https://mp.weixin.qq.com/s/qNTi04FY3KdErqPFXsRiOQ

[^7]: `node_modules/three/package.json` exports 中的 `./webgpu` 与 `./tsl` 入口.

[^8]: mrdoob/three.js. “docs/llms.txt.” https://github.com/mrdoob/three.js/blob/dev/docs/llms.txt

[^9]: mrdoob/three.js. “Sky / CSM docs 中的 WebGL 与 WebGPU 分化说明.” https://github.com/mrdoob/three.js/blob/dev/docs/pages/Sky.html.md ; https://github.com/mrdoob/three.js/blob/dev/docs/pages/CSM.html.md

[^10]: `node_modules/@sparkjsdev/spark/package.json` devDependencies.

[^11]: npm. “@sparkjsdev/spark.” 访问于 2026-09-13. https://www.npmjs.com/package/@sparkjsdev/spark

[^12]: `packages/renderer-three/src/renderer-factory.ts`.

[^13]: `packages/renderer-three/src/webgpu-render-manager.ts:680`.

[^14]: `packages/core/src/scene-manager.ts:86`.

[^15]: `packages/renderer-three/src/webgpu-render-manager.ts:1174`.

[^16]: `packages/renderer-three/src/webgpu-sort-manager.ts:202`.

[^17]: `packages/convert/src/gaussian-loader.ts:697`.

[^18]: `docs/site/guide/architecture.md` 与 `docs/site/guide/performance.md`.

[^19]: `docs/Technical-Debt/technical-debt.md`.

[^20]: `docs/site/guide/performance.md` 中的 COOP/COEP 配置说明.

[^21]: playcanvas/supersplat. https://github.com/playcanvas/supersplat

[^22]: antimatter15/splat. https://github.com/antimatter15/splat

[^23]: mkkellogg/GaussianSplats3D. https://github.com/mkkellogg/GaussianSplats3D

[^24]: KeKsBoTer/web-splat. https://github.com/KeKsBoTer/web-splat

[^25]: fynv/web_gaussian_splats. https://github.com/fynv/web_gaussian_splats

[^26]: sparkjsdev/spark. https://github.com/sparkjsdev/spark

[^27]: pmndrs/react-three-fiber、pmndrs/drei、pmndrs/three-stdlib. https://github.com/pmndrs/react-three-fiber ; https://github.com/pmndrs/drei ; https://github.com/pmndrs/three-stdlib

[^28]: 用户提供的本地 HTML 文件. “/Users/sacrtap/Desktop/111/Three.js r186：高斯泼溅正式成为引擎原生公民，三行代码渲染一个Splat.html.” 访问于 2026-09-13.

[^29]: nianticlabs/spz. https://github.com/nianticlabs/spz

[^30]: PlayCanvas. “PlayCanvas Open Sources SOG Format for Gaussian Splatting.” https://blog.playcanvas.com/playcanvas-open-sources-sog-format-for-gaussian-splatting/

[^31]: PlayCanvas. “SOG format docs.” https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/

[^32]: PlayCanvas. “Compressing Gaussian Splats.” https://blog.playcanvas.com/compressing-gaussian-splats/

[^33]: sparkjsdev/spark. “LOD Getting Started.” https://github.com/sparkjsdev/spark/blob/dev/docs/docs/lod-getting-started.md

[^34]: 项目文档. “docs/convert-quality-analysis.md.” 2026-08-28.

[^35]: playcanvas/supersplat. “src/file-handler.ts.” https://github.com/playcanvas/supersplat/blob/dev/src/file-handler.ts
