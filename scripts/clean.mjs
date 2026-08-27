/**
 * ★ D-14: 跨平台清理脚本 — 替代各包 `rm -rf dist` (Windows PowerShell 下失效)。
 *
 * 用法: pnpm clean (根目录)
 * 行为: 删除所有包与 demo 的 dist 产物; 不存在的目录静默跳过。
 */
import { rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const targets = [];

// packages/*\/dist
const packagesDir = join(root, 'packages');
for (const name of readdirSync(packagesDir)) {
  const dir = join(packagesDir, name);
  if (statSync(dir).isDirectory()) {
    targets.push(join(dir, 'dist'));
  }
}

// apps/demo/dist
targets.push(join(root, 'apps', 'demo', 'dist'));

let removed = 0;
for (const target of targets) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`✓ removed ${relative(root, target)}`);
    removed++;
  }
}
console.log(`clean 完成: 移除 ${removed} 个 dist 目录`);
