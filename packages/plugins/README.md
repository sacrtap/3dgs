# @3dgs/plugins

3DGS 漫游框架插件 — 热点系统、相机控制、场景过渡、Shader 注入等领域功能。

## 安装

```bash
npm install @3dgs/plugins
```

## 可用插件

| 插件 | 说明 |
|------|------|
| **Hotspot** | 3D 热点标注系统，支持自定义内容与交互 |
| **CameraControls** | 相机控制增强 (拖拽旋转、滚轮缩放、键盘移动) |
| **AutoRotate** | 自动旋转巡游 |
| **SceneTransition** | 场景切换过渡动画 |
| **ShaderInjection** | 运行时 GLSL Shader 注入 |
| **TouchGestures** | 移动端触摸手势支持 |
| **Fullscreen** | 全屏切换 |
| **DepthOcclusion** | 深度遮挡检测 |
| **LoadingIndicator** | 加载进度指示器 |

## 用法

```typescript
import { HotspotPlugin, AutoRotatePlugin } from '@3dgs/plugins';

player.use(new HotspotPlugin({ hotspots: [...] }));
player.use(new AutoRotatePlugin({ speed: 0.5 }));
```

## 许可证

[MIT](./LICENSE)
