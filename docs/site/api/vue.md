# @3dgs/vue

Vue 适配层。

## TourViewer 组件

```vue
<script setup lang="ts">
import { TourViewer } from '@3dgs/vue';
import { createRendererSync } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';

const config = {
  version: '1.0',
  scenes: {
    main: {
      title: '主场景',
      source: '/scenes/room.splat',
    },
  },
};

const renderer = createRendererSync();
const plugins = [createHotspotSystem()];

function onSceneSwitch(sceneId: string) {
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
    :renderer="renderer"
    :plugins="plugins"
    @scene-switch="onSceneSwitch"
    @error="onError"
    style="width: 100%; height: 100vh;"
  />
</template>
```

## Props

| Prop | 类型 | 必需 | 说明 |
|------|------|------|------|
| `config` | `TourConfig \| string` | 是 | 配置对象或 URL |
| `renderer` | `RendererAdapter \| (() => RendererAdapter)` | 是 | 渲染器实例或工厂函数 |
| `initialScene` | `string` | 否 | 初始场景 ID |
| `plugins` | `TourPlugin[]` | 否 | 要注册的插件列表 (默认 `[]`) |

## Events

| 事件 | 参数 | 说明 |
|------|------|------|
| `load` | `data: unknown` | 配置加载完成 |
| `scene-switch` | `sceneId: string` | 场景切换完成 |
| `hotspot-click` | `hotspotId: string` | 热点点击 |
| `error` | `msg: string` | 错误 |

## Expose

组件通过 `expose` 暴露以下方法：

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `getPlayer()` | `TourPlayer \| null` | 获取 TourPlayer 实例 |

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { TourViewer } from '@3dgs/vue';

const tourViewerRef = ref<InstanceType<typeof TourViewer>>();

onMounted(() => {
  const player = tourViewerRef.value?.getPlayer();
  // 可直接操作 player 实例
});
</script>

<template>
  <TourViewer ref="tourViewerRef" ... />
</template>
```
