/**
 * 示例 12: 性能调优 — blurAmount / minAlpha / focalAdjustment / 排序节流 / 视锥裁剪
 *
 * 展示:
 *   1. 设备分级自动配置质量参数
 *   2. 视锥裁剪开关与可见 splat 统计
 *   3. 排序节流间隔
 *   4. 分辨率手动调整
 */

import { TourPlayer, DeviceTier } from '@3dgs/core';
import { createRenderer, RenderManager } from '@3dgs/renderer-three';

async function main() {
  const container = document.getElementById('viewer')!;
  const player = new TourPlayer(container);

  // 强制使用 LOW tier 演示低端设备优化
  // 也可不指定, 引擎会自动检测
  const { renderer } = await createRenderer({
    deviceTier: DeviceTier.LOW,
  });
  player.setRenderer(renderer);

  // ── 1. 查看设备分级与自动配置 ──
  const tier = renderer.getDeviceTier();
  const tierNames = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
  console.log(`设备分级: ${tierNames[tier]}`);

  // 以下参数在 RenderManager 构造时根据 tier 自动设置:
  //   blurAmount:       LOW=0.1, MEDIUM=0.2, HIGH/ULTRA=0.3 (抗锯齿模糊)
  //   minAlpha:         LOW=5/255, MEDIUM=2/255, HIGH=1/255, ULTRA=0.5/255 (透明裁剪)
  //   focalAdjustment:  LOW/MED=1.0, HIGH=1.5, ULTRA=2.0 (锐利度)
  //   minSortIntervalMs: LOW=100, MEDIUM=50, HIGH=33, ULTRA=16 (排序节流)

  // ── 2. 视锥裁剪控制 ──
  renderer.setFrustumCulling?.(true); // 默认启用
  console.log(`视锥裁剪: ${renderer.getVisibleSplatCount?.()} visible splats`);

  // ── 3. 帧回调 — 实时监控 ──
  let frameCount = 0;
  let fpsTimer = performance.now();

  renderer.onFrame(() => {
    frameCount++;
    const now = performance.now();
    if (now - fpsTimer >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - fpsTimer));
      const resScale = renderer.getResolutionScale();
      const visible = renderer.getVisibleSplatCount?.() ?? '-';

      console.log(
        `FPS=${fps} | Resolution=${(resScale * 100).toFixed(0)}% | ` +
        `Visible splats=${visible}`
      );

      // 帧率过低时可手动降分辨率
      // renderer.setResolutionScale(Math.max(0.35, resScale - 0.05));

      frameCount = 0;
      fpsTimer = now;
    }
  });

  // ── 4. 加载场景 ──
  await player.load({
    version: '1.0',
    scenes: {
      main: {
        source: '/scenes/kitchen.splat',
      },
    },
  });
  await player.switchScene('main');

  // ── 5. 检查 COOP/COEP ──
  const isolated = RenderManager.isCrossOriginIsolated();
  if (!isolated) {
    console.warn(
      '⚠️ SharedArrayBuffer 不可用 — 排序在主线程执行, 性能退化.\n' +
      '请配置 COOP/COEP 头: Cross-Origin-Opener-Policy: same-origin\n' +
      '                       Cross-Origin-Embedder-Policy: require-corp'
    );
  }
}

main().catch(console.error);
