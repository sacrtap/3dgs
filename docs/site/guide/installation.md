# 安装

## 系统要求

| 要求 | 最低版本 | 推荐 |
|------|---------|------|
| Node.js | 18 | 20+ |
| pnpm | 9 | 最新 |
| 浏览器 | Chrome 113+ / Safari 16+ / Firefox 115+ | 最新版 |

## 包依赖关系

```
@3dgs/core (零运行时依赖)
├── @3dgs/renderer-three (three, @sparkjsdev/spark)
├── @3dgs/plugins
│   ├── @3dgs/react (react)
│   └── @3dgs/vue (vue)
└── @3dgs/convert (commander) — CLI 工具, 独立安装
```

## npm 安装

```bash
# 核心包 (必须)
npm install @3dgs/core @3dgs/renderer-three

# 插件包 (推荐)
npm install @3dgs/plugins

# 框架适配 (可选)
npm install @3dgs/react   # 或 @3dgs/vue

# CLI 工具 (可选, 全局安装)
npm install -g @3dgs/convert
```

## pnpm 安装

```bash
pnpm add @3dgs/core @3dgs/renderer-three @3dgs/plugins
```

## yarn 安装

```bash
yarn add @3dgs/core @3dgs/renderer-three @3dgs/plugins
```

## CDN 引入

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js",
    "@sparkjsdev/spark": "https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@2.1.0/dist/spark.module.js"
  }
}
</script>
<script type="module">
import { TourPlayer } from 'https://cdn.jsdelivr.net/npm/@3dgs/core@0.1.0/dist/index.js';
</script>
```

## 从源码构建

```bash
git clone https://github.com/sacrtap/3dgs.git
cd 3dgs
pnpm install
pnpm build
```
