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
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/index.ts'],
      // ★ coverage 阈值门禁 (保守值, 防 CI 波动误报):
      //   - 全局行覆盖 >= 55 (实测 61.47)
      //   - convert 行覆盖 >= 60 (实测 76.12) — finding 建议值
      //   - renderer-three 行覆盖 >= 50 (实测 56.35) — WebGL/WebGPU 主路径在
      //     jsdom 下天然不可测 (renderer-factory/webgpu-detector 等 0%), 阈值
      //     只防实质性退化, 行为证据由 e2e/render-smoke.ts browser E2E 补充
      thresholds: {
        lines: 55,
        statements: 55,
        functions: 55,
        'packages/convert/src/**': { lines: 60 },
        'packages/renderer-three/src/**': { lines: 50 },
      },
    },
  },
});
