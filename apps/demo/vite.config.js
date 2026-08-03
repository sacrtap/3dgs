import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    conditions: ['development', 'browser'],
  },
  server: {
    headers: {
      // ★ COOP/COEP — 启用 SharedArrayBuffer (Spark sort worker 依赖)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  optimizeDeps: {
    exclude: ['@sparkjsdev/spark'],
  },
});
