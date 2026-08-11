/**
 * 示例 9: 性能监控 — FPS + 帧时间 + 分辨率 + 后端 + 视锥裁剪
 */

import { TourPlayer } from '@3dgs/core';
import { createRenderer, RenderManager } from '@3dgs/renderer-three';

async function main() {
  const player = new TourPlayer(document.getElementById('viewer')!);

  // 异步创建渲染器 (自动检测 WebGPU)
  const { renderer, backend } = await createRenderer();
  player.setRenderer(renderer);

  // FPS 监控
  let frameCount = 0;
  let fpsTimer = performance.now();
  const hudEl = document.getElementById('hud')!;

  renderer.onFrame(() => {
    frameCount++;
    const now = performance.now();
    if (now - fpsTimer >= 500) {
      const fps = Math.round((frameCount * 1000) / (now - fpsTimer));
      const resScale = renderer.getResolutionScale();
      const tier = renderer.getDeviceTier();
      const tierNames = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
      const isolated = RenderManager.isCrossOriginIsolated() ? '✓' : '✗';
      const visibleCount = renderer.getVisibleSplatCount?.() ?? '-';

      hudEl.textContent = [
        `FPS: ${fps}`,
        `Backend: ${backend}`,
        `Tier: ${tierNames[tier]}`,
        `Resolution: ${(resScale * 100).toFixed(0)}%`,
        `Visible splats: ${visibleCount}`,
        `SAB: ${isolated}`,
      ].join(' | ');

      frameCount = 0;
      fpsTimer = now;
    }
  });

  await player.load({
    version: '1.0',
    scenes: { main: { source: '/scenes/room.splat' } },
  });
  await player.switchScene('main');
}

main().catch(console.error);
