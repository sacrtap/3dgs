# React 集成

使用 `@3dgs/react` 在 React 应用中嵌入 3DGS 场景。

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins @3dgs/react
```

## 基础用法

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
        initialView: { yaw: 0, pitch: 0, fov: 60 },
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

export default App;
```

## 使用 Hooks

```tsx
import { useRef } from 'react';
import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';

function useTourPlayer(containerRef: React.RefObject<HTMLDivElement>) {
  const playerRef = useRef<TourPlayer | null>(null);

  const init = async () => {
    if (!containerRef.current) return;
    const player = new TourPlayer(containerRef.current);
    player.setRenderer(createRendererSync());
    await player.load(config);
    await player.switchScene('main');
    playerRef.current = player;
  };

  return { playerRef, init };
}
```
