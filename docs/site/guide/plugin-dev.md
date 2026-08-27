# 插件开发

## TourPlugin 接口

```typescript
interface TourPlugin {
  name: string;
  version: string;
  init?(ctx: TourPluginContext): void;
  update?(ctx: FrameContext): void;
  destroy?(): void;
}
```

## 插件上下文

```typescript
interface TourPluginContext {
  player: TourPlayer;      // 播放器实例
  sceneManager?: SceneManager; // 场景管理器
  renderer?: RendererAdapter;  // 渲染器
  container: HTMLElement;       // DOM 容器
}

interface FrameContext {
  camera: { x: number; y: number; z: number };
  vpMatrix: Float32Array;
  size: { width: number; height: number };
  sceneManager?: SceneManager;
  deltaTime: number; // 帧间隔 (ms)
}
```

## 完整示例

```typescript
import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';

export interface MyPluginOptions {
  message?: string;
  interval?: number;
}

export function createMyPlugin(options: MyPluginOptions = {}): TourPlugin {
  const { message = 'Hello', interval = 1000 } = options;

  let ctx: TourPluginContext;
  let lastTrigger = 0;

  return {
    name: 'my-plugin',
    version: '0.1.0',

    init(pluginCtx) {
      ctx = pluginCtx;

      // 监听事件
      ctx.player.on('scene:switched', (data) => {
        console.log(`${message}: 场景已切换`, data);
      });

      // 操作 DOM
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:10px;left:10px;color:#fff;';
      el.textContent = message;
      ctx.container.appendChild(el);
    },

    update(frameCtx: FrameContext) {
      const now = performance.now();
      if (now - lastTrigger >= interval) {
        lastTrigger = now;
        // 定时逻辑
      }

      // 访问相机位置
      const { x, y, z } = frameCtx.camera;
      // 访问视图投影矩阵
      const vp = frameCtx.vpMatrix;
    },

    destroy() {
      // 清理 DOM、事件监听器等
    },
  };
}
```

## 发布插件

1. 创建 npm 包 (`@your-org/3dgs-plugin-xxx`)
2. 依赖 `@3dgs/core` (peerDependency)
3. 导出 `createXxxPlugin` 工厂函数
4. 导出 `XxxOptions` 类型

```json
{
  "name": "@your-org/3dgs-plugin-xxx",
  "peerDependencies": {
    "@3dgs/core": "^0.1.0"
  }
}
```

---

## 内置空间扩展能力 (2026-08)

除通用插件机制外，`@3dgs/plugins` 内置了三类空间扩展能力，开箱即用。

### 1. 热点点击弹出 (Hotspot Popup)

在热点配置中添加 `popup` 字段，点击热点即弹出屏幕空间面板（支持标题 / HTML 内容 / 内嵌图片）：

```typescript
import { createHotspotSystem, type HotspotSystemPlugin } from '@3dgs/plugins';

const hotspotSys: HotspotSystemPlugin = createHotspotSystem();
player.use(hotspotSys);

// 配置驱动: scene.extensions.hotspot.hotspots[].popup
{
  id: 'info', type: 'text', position: [0.8, 1.1, -1.5],
  popup: {
    title: '沙发区',
    content: '支持 <b>HTML</b> 内容',
    imageUrl: '/photo.jpg',
    width: 300,
    placement: 'auto',      // auto | center
    dismissible: true,
  },
}

// 运行时 API: 动态增删热点 + 弹窗控制
hotspotSys.addHotspot({ id: 'dyn', type: 'scene', position: [1, 1, -2], popup: { title: 'T' } });
hotspotSys.openPopup('dyn');
hotspotSys.closePopup();
hotspotSys.removeHotspot('dyn');

// 事件
player.on('hotspot:popup-open', (d) => {});
player.on('hotspot:popup-close', (d) => {});
```

### 2. 空间媒体嵌入 (图像 / 视频)

`createMediaEmbed()` 把图像或视频以**世界坐标平面**嵌入场景，每帧从相机位姿计算 CSS 3D 透视变换，与高斯场景同步，并通过多种策略无缝融合。

```typescript
import { createMediaEmbed, type MediaEmbedPlugin } from '@3dgs/plugins';

const mediaEmbed: MediaEmbedPlugin = createMediaEmbed();
player.use(mediaEmbed);

// 配置驱动: scene.extensions.media.embeds[]
{
  id: 'wall-art', type: 'image', url: '/art.png',
  position: [0, 1.6, -3], width: 2.0, height: 1.2,
  orientation: { yaw: 0 },                  // 世界固定朝向 (墙面挂画); 省略 = 公告板 (始终面向相机)
  opacity: 1, feather: 0.06,                // 边缘羽化消除硬边
  nearFade: 1.0, farFade: 12,               // 距离淡化避免穿帮
  depthBlur: { start: 5, range: 10, max: 3 }, // 深度模糊匹配远景柔化
}
{
  id: 'screen', type: 'video', url: '/intro.mp4',
  position: [-2, 1.5, -2], width: 1.6, height: 0.9,
  autoplay: true, loop: true, muted: true, toggleOnClick: true,
}

// 运行时 API
mediaEmbed.add({ id, type, url, position, width, height });
mediaEmbed.play('screen'); mediaEmbed.pause('screen');
mediaEmbed.setVolume('screen', 0.5);
mediaEmbed.remove('screen');

// 事件
player.on('media:ready', (d) => {});
player.on('media:error', (d) => {});
player.on('media:click', (d) => {});
```

::: tip 技术路线与限制
媒体通过 CSS 3D 透视叠加层渲染（不侵入渲染管线，WebGL/WebGPU 双后端通用）。平面为整体叠加，不与高斯做像素级深度交织；像素级融合需渲染管线支持（见能力规划）。
:::

### 3. Shader 预设效果库 (Shader Presets)

`createPreset()` 一行启用内置后处理效果，免去手写 GLSL：

```typescript
import { createPreset, SHADER_PRESET_NAMES, presetId } from '@3dgs/plugins';

// 调色: cool / warm / grayscale / sepia / invert
renderer.addShaderInjection(createPreset('sepia', { intensity: 0.85 }));

// 氛围: vignette (暗角)
renderer.addShaderInjection(createPreset('vignette', { intensity: 0.5 }));

// 动画: pulse / scanline (uTime 自动递增)
renderer.addShaderInjection(createPreset('pulse', { intensity: 0.5, speed: 2 }));

// 移除
renderer.removeShaderInjection(presetId('sepia')); // 'preset-sepia'
```

| 预设 | 类型 | 参数 |
|------|------|------|
| `cool` / `warm` | 调色 | `intensity` |
| `grayscale` / `sepia` / `invert` | 调色 | `intensity` |
| `vignette` | 暗角 | `intensity` |
| `pulse` / `scanline` | 动画 | `intensity`, `speed` |

完整示例见 `examples/13-spatial-extensions.ts`，交互演示见 `apps/demo`（"空间扩展" 面板）。
