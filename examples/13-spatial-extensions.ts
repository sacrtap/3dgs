/**
 * 示例 13: 空间扩展能力 — 热点弹出面板 + 空间媒体嵌入 (图像/视频) + Shader 预设
 *
 * 覆盖 2026-08-28 插件能力扩展:
 *   1. 热点点击弹出 (popup 配置: 标题/HTML/内嵌图片) + 运行时添加热点
 *   2. 空间图像嵌入 (世界坐标定位 + 羽化/深度模糊融合)
 *   3. 空间视频嵌入 (自动循环播放 + 点击播放控制)
 *   4. Shader 预设效果库 (一行启用)
 */

import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import {
  createHotspotSystem,
  createMediaEmbed,
  createPreset,
  type HotspotSystemPlugin,
  type MediaEmbedPlugin,
} from '@3dgs/plugins';

async function main() {
  const player = new TourPlayer(document.getElementById('viewer')!);
  const renderer = createRendererSync();
  player.setRenderer(renderer);

  // ── 1. 插件注册: 保留插件引用以获得运行时 API ──
  const hotspotSys: HotspotSystemPlugin = createHotspotSystem();
  const mediaEmbed: MediaEmbedPlugin = createMediaEmbed();
  player.use(hotspotSys);
  player.use(mediaEmbed);

  // ── 2. 事件监听 ──
  player.on('hotspot:popup-open', (d) => console.log('弹出面板打开:', d));
  player.on('hotspot:popup-close', (d) => console.log('弹出面板关闭:', d));
  player.on('media:ready', (d) => console.log('媒体就绪:', d));
  player.on('media:error', (d) => console.error('媒体加载失败:', d));
  player.on('media:click', (d) => console.log('媒体点击:', d));

  // ── 3. 配置驱动的热点 (含弹出面板) + 媒体 ──
  await player.load({
    version: '1.0',
    scenes: {
      main: {
        source: '/scenes/room.splat',
        extensions: {
          // 配置驱动热点: 点击弹出面板
          hotspot: {
            hotspots: [
              {
                id: 'info-sofa', type: 'text', position: [0.8, 1.1, -1.5],
                onHover: { tooltip: '沙发区说明' },
                popup: {
                  title: '沙发区',
                  content: '这是通过 <b>popup</b> 配置弹出的面板, 支持 HTML 内容与图片。',
                  imageUrl: '/media/photo.jpg',
                  width: 300,
                },
              },
            ],
          },
          // 配置驱动媒体嵌入: 墙面挂画 (固定朝向) + 悬浮信息屏 (公告板)
          media: {
            embeds: [
              {
                id: 'wall-art', type: 'image', url: '/media/art.png',
                position: [0, 1.6, -3], width: 2.0, height: 1.2,
                orientation: { yaw: 0 },           // 世界固定朝向 (墙面挂画)
                feather: 0.06,
                depthBlur: { start: 5, range: 10, max: 3 },
              },
              {
                id: 'info-screen', type: 'video', url: '/media/intro.mp4',
                position: [-2, 1.5, -2], width: 1.6, height: 0.9,
                autoplay: true, loop: true, muted: true,  // 公告板模式 (未设 orientation)
                nearFade: 1.0, farFade: 12,
              },
            ],
          },
        },
      },
    },
  });

  await player.switchScene('main');

  // ── 4. 运行时 API: 动态添加热点 (带弹出) ──
  hotspotSys.addHotspot({
    id: 'dyn-hotspot', type: 'scene', position: [1.5, 1.3, -2.5],
    style: { color: '#7cc4ff', glow: true, pulse: true },
    popup: { title: '动态热点', content: '运行时通过 addHotspot() 添加。' },
  });

  // ── 5. 运行时 API: 动态嵌入媒体 + 播放控制 ──
  mediaEmbed.add({
    id: 'dyn-image', type: 'image', url: '/media/detail.jpg',
    position: [2, 1.2, -1.8], width: 1.2, height: 0.8,
    feather: 0.1,
  });
  mediaEmbed.play('info-screen');        // 程序化播放
  mediaEmbed.setVolume('info-screen', 0.5);

  // ── 6. Shader 预设: 一行启用内置效果 ──
  renderer.addShaderInjection(createPreset('vignette', { intensity: 0.5 }));
  renderer.addShaderInjection(createPreset('warm', { intensity: 0.4 }));
  // 移除: renderer.removeShaderInjection('preset-warm');
}

main().catch(console.error);
