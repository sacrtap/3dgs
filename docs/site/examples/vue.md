# Vue 集成

使用 `@3dgs/vue` 在 Vue 3 应用中嵌入 3DGS 场景。

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins @3dgs/vue
```

## 基础用法

```vue
<script setup lang="ts">
import { TourViewer } from '@3dgs/vue';
import { createHotspotSystem } from '@3dgs/plugins';

const config = {
  version: '1.0',
  scenes: {
    main: {
      title: '主场景',
      source: '/scenes/room.splat',
      initialView: { yaw: 0, pitch: 0, fov: 60 },
    },
  },
};

const plugins = [createHotspotSystem()];

function onSceneSwitched(sceneId: string) {
  console.log('切换到:', sceneId);
}

function onError(err: Error) {
  console.error(err);
}
</script>

<template>
  <TourViewer
    :config="config"
    initial-scene="main"
    :plugins="plugins"
    @scene-switched="onSceneSwitched"
    @error="onError"
    style="width: 100%; height: 100vh;"
  />
</template>
```

## Composition API

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { TourPlayer } from '@3dgs/core';
import { createRendererSync } from '@3dgs/renderer-three';

const viewerRef = ref<HTMLDivElement>();
let player: TourPlayer | null = null;

onMounted(async () => {
  if (!viewerRef.value) return;
  player = new TourPlayer(viewerRef.value);
  player.setRenderer(createRendererSync());
  await player.load(config);
  await player.switchScene('main');
});

onUnmounted(() => {
  player?.destroy();
});
</script>

<template>
  <div ref="viewerRef" style="width: 100%; height: 100vh;" />
</template>
```
