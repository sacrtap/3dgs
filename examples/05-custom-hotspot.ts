/**
 * 示例 5: 自定义热点 — 样式 + 深度遮挡 + 事件
 */

import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import { createHotspotSystem, createDepthOcclusionPlugin } from '@3dgs/plugins';

async function main() {
  const player = new TourPlayer(document.getElementById('viewer')!);
  player.setRenderer(createRendererSync());

  player.use(createHotspotSystem());
  player.use(createDepthOcclusionPlugin({
    sampleInterval: 2,
    occludedOpacity: 0.3,
  }));

  player.on('hotspot:click', (h) => alert(`点击: ${h.id}`));
  player.on('hotspot:hover', (h) => {
    if (h.config?.onHover?.tooltip) {
      document.title = h.config.onHover.tooltip;
    }
  });

  await player.load({
    version: '1.0',
    scenes: {
      main: {
        source: '/scenes/room.splat',
        extensions: {
          hotspot: {
            hotspots: [
              {
                id: 'info-1', type: 'text', position: [0.5, 1.2, -1.0],
                onHover: { tooltip: '信息标注热点' },
              },
              {
                id: 'jump-1', type: 'scene', position: [-1.0, 1.5, -2.0],
                targetScene: 'main', transition: { type: 'fade', duration: 600 },
                style: { glow: true, pulse: true, color: '#80a0ff', size: 36 },
              },
            ],
          },
        },
      },
    },
  });

  await player.switchScene('main');
}

main().catch(console.error);
