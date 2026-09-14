#!/usr/bin/env node
// Check root AGENTS.md "Internal Markers" section cross-references.
//
// D-xx / R-xx marker definitions point at repo-internal documents and files
// (docs/..., e2e/..., .github/..., vitest.config.ts, ...). If a referenced
// path drifts (file renamed, section moved), the marker contract silently
// breaks. This script extracts those paths and fails when any is missing.
//
// Run manually:      node scripts/check-agents-refs.mjs
// Run in CI:         build-and-test job already invokes it (ci.yml).
//
// Exit code 0 = all references resolve; 1 = broken links listed on stderr.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_PATH = join(ROOT, 'AGENTS.md');

const agents = readFileSync(AGENTS_PATH, 'utf-8');

// Only the Internal Markers registry section is scope: it is the
// D-xx / R-xx cross-reference contract. Not the whole file (which also
// mentions demo paths, package names, and prose).
const SECTION_START = '## Internal Markers';
const section = agents.slice(agents.indexOf(SECTION_START));
const sectionEnd = section.indexOf('\n## ');
const markers = sectionEnd === -1 ? section : section.slice(0, sectionEnd);

// Backtick-wrapped paths inside the markers section. Strip a trailing
// ` §D-xx` / ` §R-xx` anchor (e.g. `docs/technical-debt-plan.md` §D-15).
// Only treat backticks as file references when they carry path shape:
// a slash (docs/..., .github/...), a glob star (packages/*/AGENTS.md),
// or a dotted extension (vitest.config.ts). Prose markers like `D-xx`,
// `--gate`, or `>=22` are NOT paths and are skipped.
const REF_RE = /`([^`]+)`/g;
const PATH_SHAPE_RE = /\/(?!\/)|\*|\.(md|ts|tsx|js|mjs|json|yaml|yml|jsonc)\b/;
const SKIP_RE = /^\.\.?\/|^\*|^\$|::|^#|→|\/$/;

const refs = [];
for (const m of markers.matchAll(REF_RE)) {
  const raw = m[1].trim();
  if (!PATH_SHAPE_RE.test(raw)) continue; // not a path-shaped reference
  if (SKIP_RE.test(raw)) continue; // parent-relative, glob-anchored, env vars
  if (raw === '本文件' || raw === '本段') continue; // self-references

  // Resolve § anchor suffix (e.g. "docs/foo.md §D-15 → path + anchor parts).
  // Keep the path part for existence checks.
  const pathPart = raw.split(/ §|\s+§/)[0].trim();
  if (!pathPart) continue;
  refs.push({ raw: pathPart });
}

// Deduplicate by (raw), preserving first-seen order.
const seen = new Set();
const unique = refs.filter((r) => (seen.has(r.raw) ? false : (seen.add(r.raw), true)));

const broken = [];
for (const { raw } of unique) {
  // Relative to repo root (e.g. docs/ops/rollback.md, packages/core/AGENTS.md).
  const candidate = join(ROOT, raw);
  if (!existsSync(candidate)) {
    broken.push(raw);
  }
}

if (broken.length > 0) {
  console.error(`\x1b[31m[check-agents-refs] ${broken.length} broken reference(s) in AGENTS.md Internal Markers:\x1b[0m`);
  for (const b of broken) {
    console.error(`  \x1b[31m✗\x1b[0m \`${b}\``);
  }
  console.error('\x1b[33mUpdate the marker definition to the actual repo path.\x1b[0m\n');
  process.exit(1);
}

console.log(`\x1b[32m[check-agents-refs] OK\x1b[0m — ${unique.length} reference(s) in AGENTS.md Internal Markers resolve.`);