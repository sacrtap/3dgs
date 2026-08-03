# @3dgs/vue

Vue 适配层。

## TourViewer 组件

```vue
<script setup>
import { TourViewer } from '@3dgs/vue';

const config = {
  version: '1.0',
  scenes: {
    main: {
      title: '主场景',
      source: '/scenes/room.splat',
    },
  },
};

function onSceneSwitched(sceneId) {
  console.log('切换到:', sceneId);
}

function onError(err) {
  console.error(err);
}
</script>

<template>
  <TourViewer
    :config="config"
    initial-scene="main"
    @scene-switched="onSceneSwitched"
    @error="onError"
    style="width: 100%; height: 100vh;"
  />
</template>
```

## Props

| Prop | 类型 | 说明 |
|------|------|------|
| `config` | `TourConfig \| string` | 配置对象或 URL |
| `initialScene` | `string` | 初始场景 ID |
| `plugins` | `TourPlugin[]` | 要注册的插件列表 |

## Events

| 事件 | 参数 | 说明 |
|------|------|------|
| `scene-switched` | `sceneId: string` | 场景切换完成 |
| `error` | `err: Error` | 错误 |
