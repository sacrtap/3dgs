# @3dgs/react

React 适配层。

## TourViewer 组件

```tsx
import { TourViewer } from '@3dgs/react';
import '@3dgs/demo/dist/assets/index.css'; // 可选: 样式

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

  return (
    <TourViewer
      config={config}
      initialScene="main"
      onSceneSwitched={(sceneId) => console.log('切换到:', sceneId)}
      onError={(err) => console.error(err)}
      style={{ width: '100%', height: '100vh' }}
    />
  );
}
```

## Props

| Prop | 类型 | 说明 |
|------|------|------|
| `config` | `TourConfig \| string` | 配置对象或 URL |
| `initialScene` | `string` | 初始场景 ID |
| `plugins` | `TourPlugin[]` | 要注册的插件列表 |
| `onSceneSwitched` | `(sceneId: string) => void` | 场景切换回调 |
| `onError` | `(err: Error) => void` | 错误回调 |
| `style` | `CSSProperties` | 容器样式 |
