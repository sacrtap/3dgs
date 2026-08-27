import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// ★ D-15: 源码别名 — 测试直接解析各包源码, 不再依赖先 `pnpm build`。
//   包 exports 指向 dist/, fresh clone 后未构建会导致 2 个测试文件加载失败。
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@3dgs\/core$/, replacement: resolve(root, 'packages/core/src/index.ts') },
      { find: /^@3dgs\/plugins$/, replacement: resolve(root, 'packages/plugins/src/index.ts') },
      { find: /^@3dgs\/convert$/, replacement: resolve(root, 'packages/convert/src/index.ts') },
      { find: /^@3dgs\/renderer-three$/, replacement: resolve(root, 'packages/renderer-three/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/index.ts'],
    },
  },
});
