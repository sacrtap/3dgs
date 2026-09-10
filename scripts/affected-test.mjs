#!/usr/bin/env node

/**
 * Incremental test runner — only runs tests for packages affected by recent changes.
 *
 * Usage:
 *   node scripts/affected-test.mjs              # uncommitted changes vs HEAD
 *   node scripts/affected-test.mjs --base main   # compare baseRef..HEAD (CI)
 *   node scripts/affected-test.mjs --all         # run all tests (fallback)
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = resolve(root, 'packages');

// Parse args
let baseRef = null;
let forceAll = false;
let stagedOnly = false;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--base') {
    baseRef = process.argv[++i];
  } else if (arg === '--all') {
    forceAll = true;
  } else if (arg === '--staged') {
    stagedOnly = true;
  }
}

// Discover packages
const packages = readdirSync(packagesDir)
  .filter((name) => existsSync(resolve(packagesDir, name, 'package.json')))
  .map((name) => ({ name, path: `packages/${name}` }));

if (forceAll) {
  console.log('[affected-test] Running all tests (--all)');
  execSync('pnpm test', { stdio: 'inherit', cwd: root });
  process.exit(0);
}

// Get changed files via git diff
// Default: uncommitted changes (staged + unstaged) vs HEAD
// --base <ref>: compare baseRef..HEAD (for CI/branch comparison)
// --staged: only staged changes (for pre-commit hook)
let changedFiles;
try {
  let diffCmd;
  if (baseRef) {
    diffCmd = `git diff --name-only ${baseRef} HEAD`;
  } else if (stagedOnly) {
    diffCmd = 'git diff --name-only --cached';
  } else {
    diffCmd = 'git diff --name-only HEAD';
  }
  changedFiles = execSync(diffCmd, {
    cwd: root,
    encoding: 'utf-8',
  }).trim().split('\n').filter(Boolean);
} catch {
  console.log('[affected-test] Cannot determine changed files, running all tests');
  execSync('pnpm test', { stdio: 'inherit', cwd: root });
  process.exit(0);
}

if (changedFiles.length === 0) {
  console.log('[affected-test] No changes detected, running all tests');
  execSync('pnpm test', { stdio: 'inherit', cwd: root });
  process.exit(0);
}

// Map changed files to packages
const affectedPackages = new Set();
for (const file of changedFiles) {
  for (const pkg of packages) {
    if (file.startsWith(pkg.path + '/') || file === pkg.path) {
      affectedPackages.add(pkg.name);
    }
  }
  // Changes to root config files affect all packages
  if (file.startsWith('vitest') || file === 'package.json' || file === 'tsconfig.base.json' || file === 'pnpm-workspace.yaml') {
    console.log(`[affected-test] Root config changed (${file}), running all tests`);
    execSync('pnpm test', { stdio: 'inherit', cwd: root });
    process.exit(0);
  }
}

if (affectedPackages.size === 0) {
  console.log('[affected-test] No package-level changes detected, skipping tests');
  console.log('[affected-test] (use --all to force run all tests)');
  process.exit(0);
}

// Build vitest directory paths for affected packages
const dirPaths = [...affectedPackages].map((pkg) => `packages/${pkg}/src`);

console.log(`[affected-test] Affected packages: ${[...affectedPackages].join(', ')}`);
console.log(`[affected-test] Running vitest for: ${dirPaths.join(', ')}`);

// Run vitest with only affected package directories (pass as positional args)
execSync(`pnpm exec vitest run ${dirPaths.join(' ')}`, {
  stdio: 'inherit',
  cwd: root,
});
