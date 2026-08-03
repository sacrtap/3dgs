/**
 * 示例 2: 多场景漫游 — 场景跳转 + 热点导航
 */

import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import { createHotspotSystem, createSceneTransitionPlugin } from '@3dgs/plugins';

async function main() {
  const player = new TourPlayer(document.getElementById('viewer')!);
  player.setRenderer(createRendererSync());

  player.use(createHotspotSystem());
  player.use(createSceneTransitionPlugin({ defaultDuration: 800 }));

  player.on('hotspot:click', (h) => console.log('点击热点:', h.id));
  player.on('scene:switched', (d) => console.log('切换到:', d.sceneId));

  await player.load({
    version: '1.0',
    defaults: {
      transition: { type: 'fade', duration: 800 },
    },
    scenes: {
      kitchen: {
        title: '厨房',
        source: '/scenes/kitchen.splat',
        extensions: {
          hotspot: {
            hotspots: [{
              id: 'to-living',
              type: 'scene',
              position: [1.0, 1.5, -2.0],
              targetScene: 'living',
              style: { glow: true, pulse: true, color: '#80a0ff' },
              onHover: { tooltip: '前往客厅' },
            }],
          },
        },
      },
      living: {
        title: '客厅',
        source: '/scenes/living.splat',
        extensions: {
          hotspot: {
            hotspots: [{
              id: 'to-kitchen',
              type: 'scene',
              position: [-1.0, 1.5, -2.0],
              targetScene: 'kitchen',
              style: { glow: true, pulse: true, color: '#80ff80' },
              onHover: { tooltip: '返回厨房' },
            }],
          },
        },
      },
    },
  });

  await player.switchScene('kitchen');
}

main().catch(console.error);
