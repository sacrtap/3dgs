#!/usr/bin/env node
// Check root AGENTS.md "Internal Markers" section cross-references.
//
// D-xx / R-xx marker definitions point at repo-internal documents and files
// (docs/..., e2e/..., .github/..., vitest.config.ts, ...). If a referenced
// path drifts (file renamed, section moved), the marker contract silently
// breaks. This script extracts those paths and fails when any is missing.
//
// ★ check-agents-refs-existence-only: 引用带 §D-xx/§R-xx 锚点时, 除路径存在性
//   外还校验锚点 token 在目标文档中实际存在 (章节/标记扫描) — 章节被删除或
//   移动而文件仍在时, 契约不再静默失效。
//
// Run manually:      node scripts/check-agents-refs.mjs [--root <dir>]
// Run in CI:         build-and-test job already invokes it (ci.yml).
//
// Exit code 0 = all references resolve; 1 = broken links listed on stderr.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --root 覆盖仓库根 (供受控负向验证使用); 默认 = 本脚本所在仓库根。
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const ROOT = resolve(argRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const AGENTS_PATH = join(ROOT, 'AGENTS.md');

const agents = readFileSync(AGENTS_PATH, 'utf-8');

// Only the Internal Markers registry section is scope: it is the
// D-xx / R-xx cross-reference contract. Not the whole file (which also
// mentions demo paths, package names, and prose).
const SECTION_START = '## Internal Markers';
const section = agents.slice(agents.indexOf(SECTION_START));
const sectionEnd = section.indexOf('\n## ');
const markers = sectionEnd === -1 ? section : section.slice(0, sectionEnd);

// Backtick-wrapped paths inside the markers section. A trailing
// ` §D-xx` / ` §R-xx` anchor (e.g. `docs/technical-debt-plan.md` §D-15,
// § token 通常在反引号外同行紧跟) names the marker token the referenced
// document must still define.
// Only treat backticks as file references when they carry path shape:
// a slash (docs/..., .github/...), a glob star (packages/*/AGENTS.md),
// or a dotted extension (vitest.config.ts). Prose markers like `D-xx`,
// `--gate`, or `>=22` are NOT paths and are skipped.
const REF_RE = /`([^`]+)`/g;
const PATH_SHAPE_RE = /\/(?!\/)|\*|\.(md|ts|tsx|js|mjs|json|yaml|yml|jsonc)\b/;
const SKIP_RE = /^\.\.?\/|^\*|^\$|::|^#|→|\/$/;
const ANCHOR_RE = /§([A-Za-z0-9._-]+)/;
// 锚点必须紧跟路径引用 (同行、位于其后且距引用结束 ≤48 字符), 避免
// 与行尾无关内容误配。
const MAX_ANCHOR_GAP = 48;

const refs = [];
for (const line of markers.split('\n')) {
  for (const m of line.matchAll(REF_RE)) {
    const raw = m[1].trim();
    if (!PATH_SHAPE_RE.test(raw)) continue; // not a path-shaped reference
    if (SKIP_RE.test(raw)) continue; // parent-relative, glob-anchored, env vars
    if (raw === '本文件' || raw === '本段') continue; // self-references

    // Split "path §anchor" (e.g. "docs/foo.md §D-15 → path + token parts).
    const inlineAnchor = raw.match(ANCHOR_RE);
    const pathPart = raw.split(/ §|\s+§/)[0].trim();
    if (!pathPart) continue;
    // § token 在反引号外时, 扫描该行引用结束位置之后紧跟的锚点。
    const trailing = line.slice(m.index + m[0].length).match(ANCHOR_RE);
    const anchor = inlineAnchor?.[1]
      ?? (trailing && trailing.index !== undefined && trailing.index <= MAX_ANCHOR_GAP ? trailing[1] : null);
    refs.push({ raw: pathPart, anchor });
  }
}

// Deduplicate by (path, anchor), preserving first-seen order, so the same
// file referenced with two different anchor tokens is checked for both.
const seen = new Set();
const unique = refs.filter((r) => {
  const key = `${r.raw}#${r.anchor ?? ''}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const broken = [];
let anchoredChecked = 0;
for (const { raw, anchor } of unique) {
  // Relative to repo root (e.g. docs/ops/rollback.md, packages/core/AGENTS.md).
  const candidate = join(ROOT, raw);
  if (!existsSync(candidate)) {
    broken.push(raw);
    continue;
  }
  // With a §D-xx/§R-xx anchor, the marker token must still exist inside the
  // target document — a renamed-but-present file no longer passes.
  if (anchor) {
    anchoredChecked += 1;
    try {
      const content = readFileSync(candidate, 'utf-8');
      if (!content.includes(anchor)) {
        broken.push(`${raw} (锚点 §${anchor}: 目标文档中不存在标记 token "${anchor}")`);
      }
    } catch {
      // 二进制/不可读目标: 保持存在性语义, 不做内容断言, 避免误报。
    }
  }
}

if (broken.length > 0) {
  console.error(`\x1b[31m[check-agents-refs] ${broken.length} broken reference(s) in AGENTS.md Internal Markers:\x1b[0m`);
  for (const b of broken) {
    console.error(`  \x1b[31m✗\x1b[0m \`${b}\``);
  }
  console.error('\x1b[33mUpdate the marker definition to the actual repo path or restore the missing section/token.\x1b[0m\n');
  process.exit(1);
}

console.log(`\x1b[32m[check-agents-refs] OK\x1b[0m — ${unique.length} reference(s) in AGENTS.md Internal Markers resolve (${anchoredChecked} anchored token(s) verified).`);