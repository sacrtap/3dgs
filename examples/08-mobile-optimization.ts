/**
 * 示例 8: 移动端优化 — 设备分级 + 触摸手势
 */

import { TourPlayer } from '@3dgs/core';
import { createRendererSync, RenderManager } from '@3dgs/renderer-three';
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
  const tierNames = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
  console.log(`设备分级: ${tierNames[tier]}`);

  // 移动端可访问质量参数 (通过 device-tier 配置自动应用)
  // LOW: blurAmount=0.1, minAlpha=5/255, minSortIntervalMs=100
  // MEDIUM: blurAmount=0.2, minAlpha=2/255, minSortIntervalMs=50
  // 这些参数在 RenderManager 构造时根据 tier 自动设置

  // 检查 SharedArrayBuffer 可用性
  const isolated = RenderManager.isCrossOriginIsolated();
  console.log(`SharedArrayBuffer: ${isolated ? '✓' : '✗ (排序性能退化)'}`);

  await player.load({
    version: '1.0',
    scenes: { main: { source: '/scenes/room.splat' } },
  });
  await player.switchScene('main');
}

main().catch(console.error);
