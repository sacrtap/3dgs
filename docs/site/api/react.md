# @3dgs/react

React 适配层。

## TourViewer 组件

```tsx
import { useMemo } from 'react';
import { TourViewer } from '@3dgs/react';
import { createRendererSync } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';

function App() {
  const config = {
    version: '1.0',
    scenes: {
      main: {
        title: '主场景',
        source: '/scenes/room.splat',
      },
    },
  };

  // ★ 使用 useMemo 稳定引用, 避免每次渲染重建 TourPlayer
  const renderer = useMemo(() => createRendererSync(), []);
  const plugins = useMemo(() => [createHotspotSystem()], []);

  return (
    <TourViewer
      config={config}
      initialScene="main"
      renderer={renderer}
      plugins={plugins}
      onSceneSwitch={(sceneId) => console.log('切换到:', sceneId)}
      onError={(err) => console.error(err)}
      style={{ width: '100%', height: '100vh' }}
    />
  );
}
```

## Props

| Prop | 类型 | 必需 | 说明 |
|------|------|------|------|
| `config` | `TourConfig \| string` | 是 | 配置对象或 URL |
| `renderer` | `RendererAdapter \| (() => RendererAdapter)` | 是 | 渲染器实例或工厂函数 |
| `initialScene` | `string` | 否 | 初始场景 ID |
| `plugins` | `TourPlugin[]` | 否 | 要注册的插件列表 |
| `className` | `string` | 否 | 容器 CSS 类名 |
| `style` | `CSSProperties` | 否 | 容器样式 |
| `onLoad` | `TourPlayerHandler` | 否 | 配置加载完成回调 |
| `onSceneSwitch` | `(sceneId: string) => void` | 否 | 场景切换回调 |
| `onHotspotClick` | `(hotspotId: string) => void` | 否 | 热点点击回调 |
| `onError` | `(error: string) => void` | 否 | 错误回调 |
| `onEvent` | `(type: string, data: unknown) => void` | 否 | 通用事件回调 (接收所有事件) |

### 关于引用稳定性

`renderer` 和 `plugins` 的引用变化会触发 `TourPlayer` 重建。建议使用 `useMemo` 包裹：

```tsx
// ✅ 正确: 使用 useMemo 稳定引用
const renderer = useMemo(() => createRendererSync(), []);
const plugins = useMemo(() => [createHotspotSystem()], []);

<TourViewer config={config} renderer={renderer} plugins={plugins} />

// ❌ 错误: 每次渲染创建新实例, 导致 TourPlayer 重建
<TourViewer config={config} renderer={createRendererSync()} />
```

`config` 和回调函数 (`onLoad`, `onSceneSwitch` 等) 通过 ref 传递，变化时仅重新加载配置，不会重建 `TourPlayer`。
