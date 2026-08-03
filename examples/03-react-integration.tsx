/**
 * 示例 3: React 集成
 */

import React from 'react';
import { TourViewer } from '@3dgs/react';
import { createHotspotSystem, createFullscreenPlugin } from '@3dgs/plugins';

export function App() {
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

  return (
    <TourViewer
      config={config}
      initialScene="main"
      plugins={[createHotspotSystem(), createFullscreenPlugin()]}
      onSceneSwitched={(sceneId) => console.log('切换到:', sceneId)}
      onError={(err) => console.error(err)}
      style={{ width: '100%', height: '100vh' }}
    />
  );
}
