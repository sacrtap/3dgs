/**
 * 示例 11: SOG 流式加载 — 分块渐进式渲染 + LOD + onFirstFrame
 *
 * 展示:
 *   1. SOG v2 流式加载 (gzip 压缩 + 预构建 LOD 树)
 *   2. onFirstFrame 回调 — 首帧渲染后隐藏加载遮罩
 *   3. onProgress 回调 — 加载进度展示
 *   4. 预构建 LOD 层级查询
 */

import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';

async function main() {
  const container = document.getElementById('viewer')!;
  const loadingMask = document.getElementById('loading-mask')!;
  const progressBar = document.getElementById('progress-bar')!;
  const player = new TourPlayer(container);

  // 创建渲染器
  const { renderer, backend } = await createRenderer();
  player.setRenderer(renderer);

  // 加载 SOG 流式场景
  await player.load({
    version: '1.0',
    scenes: {
      'large-scene': {
        title: '大场景 (SOG 流式)',
        source: '/scenes/large.splat',
        lodSource: '/scenes/large.sog', // SOG v2 流式 LOD URL
      },
    },
  });

  // 切换到场景 — 使用 SOG 流式加载选项
  await player.switchScene('large-scene', {
    type: 'instant',
  });

  // 也可以直接在渲染器上调用 loadScene
  // await renderer.loadScene('/scenes/large.splat', {
  //   lodSource: '/scenes/large.sog',
  //   onProgress: (loaded, total) => {
  //     const pct = ((loaded / total) * 100).toFixed(1);
  //     progressBar.style.width = `${pct}%`;
  //     console.log(`加载进度: ${loaded}/${total} splats (${pct}%)`);
  //   },
  //   onFirstFrame: () => {
  //     loadingMask.style.display = 'none';
  //     console.log('✓ 首帧已渲染');
  //   },
  // });

  // 查询预构建 LOD 层级 (SOG v2 特性)
  const lodLevels = renderer.getSogLodLevels?.();
  const lodBase = renderer.getSogLodBase?.();
  if (lodLevels) {
    console.log(`预构建 LOD: ${lodLevels.length} 层, base=${lodBase}`);
    console.log(`LOD 层级 (累计 splats): ${lodLevels.join(' → ')}`);
  }

  console.log(`后端: ${backend}`);
}

main().catch(console.error);
