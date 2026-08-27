# 插件能力规划与实现方案

> **日期**: 2026-08-28
> **范围**: `@3dgs/plugins` 能力扩展 — 热点交互、空间媒体嵌入（图像/视频）、Shader 效果、集成开发与文档
> **关联**: 开发指南见 `docs/site/guide/plugin-dev.md`（同步更新），示例见 `examples/` 与 `apps/demo`

---

## 1. 现状盘点（9 个插件）

| 插件 | 能力 | 状态 |
|------|------|------|
| `hotspot` | 热点投影/点击/悬停/场景跳转/预加载 | ✅ 成熟，缺**点击弹出面板** |
| `camera-controls` | 拖拽/滚轮缩放 | ✅ |
| `touch-gestures` | 双指缩放/旋转/惯性 | ✅ |
| `scene-transition` | fade/fly/instant 过渡 | ✅（fly 消费端待落地，债务 D-07） |
| `depth-occlusion` | 热点深度遮挡半透明 | ✅ |
| `shader-injection` | GLSL/WGSL 注入封装 | ✅ 缺**预设效果库** |
| `auto-rotate` / `fullscreen` / `loading-indicator` | 辅助能力 | ✅ |

**核心机制**（扩展的基础）：
- `TourPlugin` 接口：`init(ctx)` / `update(frameCtx)` / `destroy()`；
- `FrameContext` 提供 `camera` 位置、`vpMatrix`（16 元素 VP 矩阵）、`size`、`deltaTime` —— **足够实现任意世界坐标 → 屏幕投影**；
- 事件总线：`player.on/emit`（`hotspot:click`、`scene:switched` 等）；
- 配置驱动：`SceneConfig.extensions.<name>` 随场景切换自动加载。

## 2. 能力规划

### 2.1 热点点击弹出（hotspot popup）— 扩展既有插件

**设计**（向后兼容，纯增量）：
```jsonc
{
  "id": "info-sofa", "type": "text", "position": [1, 1.2, -2],
  "popup": {
    "title": "沙发区",
    "content": "支持文本 / HTML 片段",
    "imageUrl": "/photo.jpg",      // 可选：弹层内嵌图
    "width": 280,
    "placement": "auto",            // auto/top/bottom/center
    "dismissible": true             // 点击遮罩/关闭按钮关闭
  }
}
```
- 点击热点 → 屏幕空间弹出面板（跟随热点位置，越界自动翻转），遮罩 + 关闭按钮；
- 事件：`hotspot:popup-open` / `hotspot:popup-close`（UI 层可拦截自定义渲染）；
- 编程式：`manager.openPopup(id)` / `closePopup()`；
- 耗时影响：0（纯 DOM）。

### 2.2 空间媒体嵌入（图像 + 视频）— 新插件 `media-embed`

**技术路线**：双模式渲染（不侵入渲染管线，双后端通用）：
1. 每帧从 `vpMatrix` **解析相机外参**（位置 + 朝向，闭式解：`Rc = [c0 c1 c2]`、`camCenter = -Rcᵀ·t`）；
2. **默认 2D 公告板**：屏幕空间投影（屏幕定位 + 距离缩放 `s = fy / d`），稳健可靠、内容必定显示；
3. **配置 `orientation`（yaw/pitch）时**切换为 **CSS 3D matrix3d** 透视变换（`perspective: fy` + 世界→CSS 相机空间，Y 翻转），实现墙面挂画固定朝向融合；
4. **无缝融合**策略（可配置）：
   - 距离淡化：`nearFade/farFade` 相机过近/过远渐隐，避免硬切穿帮；
   - 深度模糊：`depthBlur` 按距离加 CSS `blur`，匹配 3DGS 远景柔化；
   - 羽化边缘：`feather` CSS mask 径向渐变，消除平面硬边；
   - 透明度混合：`opacity`。
4. 视频：`<video>` 元素 + `play/pause/mute/volume/rate` API，`autoplay` 默认静音（浏览器策略），事件 `media:ready/media:error/media:click`。

**配置**：`SceneConfig.extensions.media.embeds[]`，场景切换自动装载/卸载；编程式 `add/remove/play/pause` API。

**已知限制**（文档明示）：媒体平面为 DOM 叠加，不与 splat 做像素级深度交织（平面前后遮挡按整体深度近似）；像素级融合需渲染管线支持（排期项 §2.5）。

### 2.3 Shader 效果库 — 扩展 `shader-injection`

新增 `ShaderPresets`：内置 `cool/warm/grayscale/sepia/invert/vignette/pulse/scanline` 预设（GLSL3 安全、`FRAGMENT_MAIN_END` 钩子、uniform 自动接线），一行启用：
```ts
player.getRenderer()?.addShaderInjection(createPreset('vignette', { intensity: 0.6 }));
```
耗时影响：每效果一次片元着色器追加分支，实测可忽略。

### 2.4 集成开发能力

| 能力 | 实现 |
|------|------|
| 配置驱动 | `extensions.hotspot.popup` / `extensions.media` 随 `tour.json` 声明式加载 |
| 事件驱动 | 新增 `hotspot:popup-open/close`、`media:click/ready/error` 事件 |
| 编程式 | 插件实例 API（`createMediaEmbed()` 返回带方法的插件对象）+ `player.emit` 控制 |
| 子路径导入 | `@3dgs/plugins/media-embed` 等（exports 已就位） |
| demo 集成 | 交互面板：动态添加热点（带弹出）、嵌入图像/视频、切换 Shader 预设 |

### 2.5 其他建议能力（一并规划，按优先级）

| 优先级 | 能力 | 说明 |
|--------|------|------|
| 已实现 | 热点弹出 / 媒体嵌入 / Shader 预设 | 本次交付 |
| 建议 P2 | **罗盘/小地图导航** | 基于相机朝向的 2D 罗盘，`extensions.minimap` |
| 建议 P2 | **语音解说（音频热点）** | 热点触发空间音频，`extensions.audio` |
| 建议 P2 | **截图/分享** | `canvas.toDataURL` + 水印，一键分享 |
| 建议 P3 | **像素级媒体融合** | 渲染管线内纹理平面（WebGL 后端合成），真正深度交织 |
| 建议 P3 | **VR/陀螺仪模式** | DeviceOrientation 相机 + 全屏沉浸 |
| 建议 P3 | **多人同步漫游** | WebRTC 位姿同步（实验） |

## 3. 交付清单（已实现并验证）

1. ✅ `packages/plugins/src/hotspot/`：popup 弹窗能力 + 运行时增删热点/弹窗控制 + 事件 + 测试（功能验证 6/6）
2. ✅ `packages/plugins/src/media-embed/`：camera-extract（VP→外参闭式解, 18 数学单测）+ 图像/视频嵌入（功能验证 8/8）
3. ✅ `packages/plugins/src/shader-injection/presets.ts`：8 预设 + 测试（8 单测 + 功能验证 2/2）
4. ✅ `apps/demo`："空间扩展" 交互面板（热点/图像/视频/清除）+ `scripts/generate-media.mjs` 演示资产生成 + `media:generate` 脚本
5. ✅ `docs/site/guide/plugin-dev.md` 新增"内置空间扩展能力"章节 + `examples/13-spatial-extensions.ts` 示例
6. ✅ 验证：单元测试（投影数学 18 + 预设 8 + 索引管线 8）+ Playwright 浏览器功能验证 15/15 通过；`pnpm test` 509 通过、`pnpm build` / `pnpm lint` 全绿。

