# 贡献指南

感谢你对 3DGS 项目的关注！本文档指导如何参与项目开发。

## 开发环境准备

### 前置要求

- Node.js >= 18
- pnpm >= 9
- Chrome / Edge 浏览器 (支持 WebGL2)

### 初始化

```bash
# 克隆仓库
git clone https://github.com/sacrtap/3dgs.git
cd 3dgs

# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 启动 Demo
pnpm --filter @3dgs/demo dev
```

## 项目结构

```
3dgs/
├── packages/
│   ├── core/              # 核心框架 (TourPlayer, SceneManager, PluginSystem)
│   ├── renderer-three/     # Three.js + Spark 渲染器
│   ├── plugins/            # 官方插件 (热点, 相机控制, 过渡动画等)
│   ├── react/              # React 适配层
│   ├── vue/                # Vue 适配层
│   └── convert/            # 数据转换 CLI (PLY → SPLAT/SPZ/SOG)
├── apps/demo/              # 可运行 Demo
├── benchmarks/             # 性能基准测试
├── docs/                   # 文档
└── tests/                  # 测试
```

## 开发流程

### 1. 创建分支

```bash
git checkout -b feature/your-feature-name
```

分支命名规范:
- `feature/*` — 新功能
- `fix/*` — Bug 修复
- `docs/*` — 文档更新
- `refactor/*` — 代码重构

### 2. 编写代码

遵循现有代码风格:
- TypeScript 严格模式
- 每个公开 API 需有 JSDoc 注释
- 复杂逻辑需有行内注释说明原理
- 外部 API 引用需标注来源

### 3. 代码检查

```bash
# Lint
pnpm lint

# 构建
pnpm build
```

确保无 lint 错误且构建通过。

### 4. 提交代码

使用 Conventional Commits 规范:

```
<type>(<scope>): <description>

types: feat, fix, docs, style, refactor, test, chore
scopes: core, renderer, plugins, convert, demo, docs
```

示例:
```
feat(plugins): add auto-rotate plugin
fix(renderer): fix LOD tree construction on small scenes
docs(core): update TourPlayer API reference
```

### 5. 创建 Pull Request

- PR 标题遵循 Conventional Commits 规范
- PR 描述需包含: 变更内容、测试方式、关联 Issue
- 确保 CI 检查通过

## 插件开发

3DGS 使用插件系统扩展功能。开发新插件需实现 `TourPlugin` 接口:

```typescript
import type { TourPlugin, TourPluginContext, FrameContext } from '@3dgs/core';

export function createMyPlugin(options?: MyPluginOptions): TourPlugin {
  let ctx: TourPluginContext;

  return {
    name: 'my-plugin',
    version: '0.1.0',

    init(pluginCtx: TourPluginContext) {
      ctx = pluginCtx;
      // 监听事件、创建 DOM 元素等
      ctx.player.on('scene:switched', () => { /* ... */ });
    },

    update(frameCtx: FrameContext) {
      // 每帧更新逻辑
    },

    destroy() {
      // 清理资源
    },
  };
}
```

## 性能基准测试

修改渲染相关代码后，建议运行性能基准测试:

```bash
# 1. 启动 Demo 开发服务器
pnpm --filter @3dgs/demo dev

# 2. 运行基准测试
npx tsx benchmarks/benchmark.ts
```

确保性能无回归。

## Issue 报告

提交 Issue 时请包含:
- 问题描述
- 复现步骤
- 浏览器和设备信息
- 控制台错误日志
- 截图 (如适用)

## 行为准则

- 尊重所有参与者
- 保持专业和友好的态度
- 欢迎新手提问
- 关注代码质量而非个人偏好

## License

本项目使用 [MIT License](./LICENSE)。
