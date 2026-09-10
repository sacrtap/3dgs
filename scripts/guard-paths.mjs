#!/usr/bin/env node
// Pre-commit guard: blocks staged files matching AGENTS.md "Do Not Touch" paths.
// Patterns mirror .gitignore but catch force-added (git add -f) files.
const FORBIDDEN = [
  { pattern: /^dist\//, label: 'dist/ (build output)' },
  { pattern: /^coverage\//, label: 'coverage/ (test coverage)' },
  { pattern: /^\.changeset\//, label: '.changeset/ (managed by changesets tooling)' },
  { pattern: /^benchmarks\/reports\//, label: 'benchmarks/reports/ (benchmark output)' },
  { pattern: /^banks\//, label: 'banks/ (internal database)' },
  { pattern: /\.ply$/, label: '*.ply (large data file)' },
  { pattern: /\.sog$/, label: '*.sog (large data file)' },
  { pattern: /\.splat$/, label: '*.splat (large data file)' },
  { pattern: /\.spz$/, label: '*.spz (large data file)' },
];

// Kitchen demo assets are explicitly allowed despite matching data-file patterns.
const ALLOWED = /^apps\/demo\/public\/kitchen\.(ply|sog|splat|spz)$/;

const staged = await execFile('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']);

const violations = [];
for (const file of staged.trim().split('\n').filter(Boolean)) {
  if (ALLOWED.test(file)) continue;
  for (const { pattern, label } of FORBIDDEN) {
    if (pattern.test(file)) {
      violations.push({ file, label });
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('\n\x1b[31m[guard-paths] Commit blocked — staged files match "Do Not Touch" paths:\x1b[0m\n');
  for (const { file, label } of violations) {
    console.error(`  ${file}  \x1b[2m→ ${label}\x1b[0m`);
  }
  console.error('\n\x1b[33mThese paths are declared off-limits in AGENTS.md and .gitignore.\x1b[0m');
  console.error('\x1b[33mIf this is intentional, bypass with: git commit --no-verify\x1b[0m\n');
  process.exit(1);
}

async function execFile(cmd, args) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (r.status !== 0) {
    console.error(`[guard-paths] git command failed: ${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
}
