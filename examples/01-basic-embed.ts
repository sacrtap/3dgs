/**
 * 示例 1: 基础嵌入 — 最简单的 3DGS 场景加载
 *
 * 运行方式:
 *   1. 将此文件放入你的项目
 *   2. 准备一个 .splat 文件放在 /scenes/room.splat
 *   3. 配置 COOP/COEP 头
 *   4. 在浏览器中打开
 */

import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';

async function main() {
  const container = document.getElementById('viewer')!;

  // 创建播放器
  const player = new TourPlayer(container);

  // 异步创建渲染器 (自动检测 WebGPU, 不可用回退 WebGL2)
  const { renderer, backend } = await createRenderer();
  console.log(`使用后端: ${backend}`); // 'webgpu' 或 'webgl2'
  player.setRenderer(renderer);

  // 加载配置
  await player.load({
    version: '1.0',
    scenes: {
      main: {
        title: '我的场景',
        source: '/scenes/room.splat',
        initialView: { yaw: 0, pitch: 0, fov: 60 },
      },
    },
  });

  // 切换到场景
  await player.switchScene('main');

  console.log('✓ 场景加载完成');
}

main().catch(console.error);
