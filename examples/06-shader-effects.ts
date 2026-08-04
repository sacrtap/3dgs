/**
 * 示例 6: Shader 效果 — 色调调整 + 动画
 */

import { TourPlayer, ShaderHookPoint } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import { createShaderInjectionPlugin } from '@3dgs/plugins';

async function main() {
  const player = new TourPlayer(document.getElementById('viewer')!);
  player.setRenderer(createRendererSync());

  // 注册脉冲动画 Shader 效果
  player.use(createShaderInjectionPlugin({
    injections: [{
      id: 'pulse',
      hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
      uniforms: { uTime: 0.0 },
      code: 'fragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
      onUpdate: (u, dt) => { u.uTime.value += dt / 1000; },
    }],
  }));

  // 也可以直接通过渲染器 API 添加
  const renderer = player.getRenderer()!;
  renderer.addShaderInjection({
    id: 'vignette',
    hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
    uniforms: { uIntensity: 0.5 },
    code: 'vec2 uv = gl_FragCoord.xy / vec2(1920.0, 1080.0); float dist = distance(uv, vec2(0.5)); fragColor.rgb *= 1.0 - dist * uIntensity;',
  });

  await player.load({
    version: '1.0',
    scenes: { main: { source: '/scenes/room.splat' } },
  });
  await player.switchScene('main');
}

main().catch(console.error);
