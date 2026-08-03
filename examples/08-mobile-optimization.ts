/**
 * 示例 8: 移动端优化 — 设备分级 + 触摸手势
 */

import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import { createTouchGesturesPlugin, createAutoRotatePlugin } from '@3dgs/plugins';

async function main() {
  const player = new TourPlayer(document.getElementById('viewer')!);
  const renderer = createRendererSync({
    adaptiveResolution: true,  // 自适应分辨率
    enableLod: true,           // LOD 树
  });
  player.setRenderer(renderer);

  // 触摸手势 (捏合缩放/双指旋转/惯性)
  player.use(createTouchGesturesPlugin({
    pinchSensitivity: 1.0,
    rotationSensitivity: 1.0,
    inertiaDamping: 0.95,
  }));

  // 自动旋转 (5 秒无操作后)
  player.use(createAutoRotatePlugin({
    speed: 8,
    idleDelay: 5000,
    pauseOnInteraction: true,
  }));

  // 检查设备分级
  const tier = renderer.getDeviceTier();
  console.log(`设备分级: ${['LOW', 'MEDIUM', 'HIGH', 'ULTRA'][tier]}`);

  await player.load({
    version: '1.0',
    scenes: { main: { source: '/scenes/room.splat' } },
  });
  await player.switchScene('main');
}

main().catch(console.error);
