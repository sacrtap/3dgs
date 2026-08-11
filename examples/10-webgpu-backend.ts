/**
 * 示例 10: WebGPU 后端 — 自动检测 + 回退 + 能力查询
 *
 * 展示:
 *   1. createRenderer() 异步创建, 自动检测 WebGPU
 *   2. 检测 GPU 类型 (discrete/integrated/mobile/software)
 *   3. 检测纹理压缩支持 (BC/ETC2/ASTC)
 *   4. 回退到 WebGL2 时的处理
 */

import { TourPlayer } from '@3dgs/core';
import { createRenderer, detectWebGPU, isWebGPUMaybeAvailable } from '@3dgs/renderer-three';

async function main() {
  const container = document.getElementById('viewer')!;
  const player = new TourPlayer(container);

  // ── 1. 快速同步检测 (不创建 GPU 上下文) ──
  const maybeAvailable = isWebGPUMaybeAvailable();
  console.log(`WebGPU 可能可用: ${maybeAvailable ? '✓' : '✗'}`);

  // ── 2. 详细异步检测 ──
  const capability = await detectWebGPU();
  if (capability.supported) {
    console.log(`GPU 类型: ${capability.gpuType}`); // discrete/integrated/mobile/software
    if (capability.adapterInfo) {
      console.log(`GPU: ${capability.adapterInfo.vendor} ${capability.adapterInfo.architecture}`);
    }
    if (capability.textureCompression) {
      const tc = capability.textureCompression;
      console.log(`纹理压缩: BC=${tc.bc ? '✓' : '✗'} ETC2=${tc.etc2 ? '✓' : '✗'} ASTC=${tc.astc ? '✓' : '✗'}`);
    }
    if (capability.recommendedMaxSplats) {
      console.log(`推荐 maxSplats: ${capability.recommendedMaxSplats.toLocaleString()}`);
    }
  } else {
    console.log(`WebGPU 不可用: ${capability.reason}`);
  }

  // ── 3. 创建渲染器 (自动选择后端) ──
  const { renderer, backend, webgpuCapability } = await createRenderer({
    preferredBackend: 'webgpu', // 优先 WebGPU
    forceBackend: false,        // 不可用则回退 WebGL2
  });

  console.log(`实际后端: ${backend}`); // 'webgpu' 或 'webgl2'

  player.setRenderer(renderer);

  // ── 4. 加载场景 ──
  await player.load({
    version: '1.0',
    scenes: {
      main: {
        source: '/scenes/kitchen.splat',
        initialView: { yaw: 0, pitch: 0, fov: 60 },
      },
    },
  });
  await player.switchScene('main');
}

main().catch(console.error);
