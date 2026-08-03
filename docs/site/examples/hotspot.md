# 自定义热点

热点标注、样式自定义、事件处理。

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';
import { createHotspotSystem, createDepthOcclusionPlugin } from '@3dgs/plugins';

const player = new TourPlayer(document.getElementById('viewer'));
player.setRenderer(createRendererSync());

// 热点系统 + 深度遮挡检测
player.use(createHotspotSystem());
player.use(createDepthOcclusionPlugin({
  sampleInterval: 2,       // 每 2 帧采样一次
  occludedOpacity: 0.3,    // 遮挡时透明度
}));

// 热点事件
player.on('hotspot:click', (hotspot) => {
  console.log('点击热点:', hotspot.id);
});

player.on('hotspot:hover', (hotspot) => {
  if (hotspot.config?.onHover?.tooltip) {
    showTooltip(hotspot.config.onHover.tooltip);
  }
});

await player.load({
  version: '1.0',
  scenes: {
    main: {
      source: '/scenes/room.splat',
      extensions: {
        hotspot: {
          hotspots: [
            // 文本标注
            {
              id: 'info-1',
              type: 'text',
              position: [0.5, 1.2, -1.0],
              onHover: { tooltip: '信息标注' },
            },
            // 场景跳转
            {
              id: 'jump-1',
              type: 'scene',
              position: [-1.0, 1.5, -2.0],
              targetScene: 'other',
              transition: { type: 'fade', duration: 600 },
              style: { glow: true, pulse: true, color: '#80a0ff', size: 36 },
            },
            // 图片标注
            {
              id: 'img-1',
              type: 'image',
              position: [1.0, 1.0, -1.5],
              style: { imageUrl: '/icons/marker.png', size: 28 },
            },
          ],
        },
      },
    },
  },
});
```

## 热点样式

| 样式字段 | 类型 | 说明 |
|---------|------|------|
| `color` | `string` | 颜色 (hex/rgb) |
| `size` | `number` | 大小 (px) |
| `glow` | `boolean` | 发光效果 |
| `pulse` | `boolean` | 脉冲动画 |
| `imageUrl` | `string` | 自定义图标 |
