# @3dgs/vue

Vue 3 适配层 — `<TourViewer />` 组件。

## 安装

```bash
npm install @3dgs/vue @3dgs/core @3dgs/renderer-three
```

## 依赖

需安装 peerDependencies：

```bash
npm install vue
```

## 用法

```vue
<script setup>
import { TourViewer } from '@3dgs/vue';
import '@3dgs/renderer-three';
</script>

<template>
  <TourViewer
    source="/scenes/demo1.splat"
    width="100%"
    height="100vh"
  />
</template>
```

## 许可证

[MIT](./LICENSE)
