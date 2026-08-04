# @3dgs/react

React 适配层 — `<TourViewer />` 组件。

## 安装

```bash
npm install @3dgs/react @3dgs/core @3dgs/renderer-three
```

## 依赖

需安装 peerDependencies：

```bash
npm install react react-dom
```

## 用法

```tsx
import { TourViewer } from '@3dgs/react';
import '@3dgs/renderer-three';

function App() {
  return (
    <TourViewer
      source="/scenes/demo1.splat"
      width="100%"
      height="100vh"
    />
  );
}
```

## 许可证

[MIT](./LICENSE)
