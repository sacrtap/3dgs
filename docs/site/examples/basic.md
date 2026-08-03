# 基础嵌入

3 行代码嵌入 3DGS 场景。

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';

// 1. 创建播放器
const player = new TourPlayer(document.getElementById('viewer'));

// 2. 设置渲染器
player.setRenderer(createRendererSync());

// 3. 加载并显示
await player.load({
  version: '1.0',
  scenes: {
    main: { source: '/scenes/room.splat' },
  },
});
await player.switchScene('main');
```

## 完整 HTML 示例

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; }
    #viewer { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="viewer"></div>
  <script type="module">
    import { TourPlayer } from '@3dgs/core';
    import { createRendererSync } from '@3dgs/renderer-three';

    const player = new TourPlayer(document.getElementById('viewer'));
    player.setRenderer(createRendererSync());
    await player.load({ version: '1.0', scenes: { main: { source: '/room.splat' } } });
    await player.switchScene('main');
  </script>
</body>
</html>
```
