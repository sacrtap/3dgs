#!/usr/bin/env node
// Agent asset inventory & integrity check.
//
// ★ agent-asset-inventory-gap: 资产盘点遗漏 4 个嵌套 AGENTS.md 与
//   .husky/pre-commit hook — 规则与门禁资产不在确定性扫描内, 漂移无法被检测。
//   本脚本建立项目级资产盘点 + 完整性校验:
//   - 盘点 Rules: 根 AGENTS.md + packages/*/AGENTS.md (嵌套指令文件)
//   - 盘点 Hooks: .husky/pre-commit (pre-commit 门禁链)
//   - 完整性: 根 AGENTS.md "Package-local AGENTS" 段引用与文件系统双向核对,
//     任何一侧漂移 (悬空引用 / 未登记嵌套文件 / hook 缺失或失挂载) 即失败。
//
// Run manually:      node scripts/check-agent-assets.mjs [--json] [--root <dir>]
// Run in CI:         build-and-test job invokes it (ci.yml).
// Run in pre-commit: .husky/pre-commit invokes it (guard-paths 之后)。
//
// Exit code 0 = 资产盘点完整; 1 = 盘点缺口/漂移, 问题列在 stderr。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --root 覆盖仓库根 (供受控负向验证使用); 默认 = 本脚本所在仓库根。
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const ROOT = resolve(argRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const JSON_OUT = process.argv.includes('--json');

const AGENTS_PATH = join(ROOT, 'AGENTS.md');
const HUSKY_PRECOMMIT = join(ROOT, '.husky', 'pre-commit');
const PACKAGES_DIR = join(ROOT, 'packages');

const SECTION_HEAD = '### Package-local AGENTS';
const REF_RE = /`(packages\/[a-z0-9-]+\/AGENTS\.md)`/g;

function readAgents() {
  return readFileSync(AGENTS_PATH, 'utf-8');
}

// 根 AGENTS.md "Package-local AGENTS" 段中被引用的嵌套指令路径 (有序去重)。
function referencedNestedAgents(agents) {
  const start = agents.indexOf(SECTION_HEAD);
  if (start === -1) return [];
  const section = agents.slice(start);
  const sectionEnd = section.indexOf('\n## ');
  const body = sectionEnd === -1 ? section : section.slice(0, sectionEnd);
  const seen = new Set();
  const refs = [];
  for (const m of body.matchAll(REF_RE)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    refs.push(m[1]);
  }
  return refs;
}

// 文件系统实际存在的嵌套指令文件 (packages/*/AGENTS.md, 与仓库现状一致的一层嵌套)。
function discoveredNestedAgents() {
  if (!existsSync(PACKAGES_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const rel = `packages/${entry}/AGENTS.md`;
    if (existsSync(join(ROOT, rel))) out.push(rel);
  }
  return out.sort();
}

function hookCheck() {
  if (!existsSync(HUSKY_PRECOMMIT)) {
    return { ok: false, issue: '.husky/pre-commit 缺失 — hook 资产不在门禁链上' };
  }
  const content = readFileSync(HUSKY_PRECOMMIT, 'utf-8');
  if (!content.includes('scripts/guard-paths.mjs')) {
    return { ok: false, issue: '.husky/pre-commit 未挂载 guard-paths — pre-commit 门禁链不完整' };
  }
  return { ok: true };
}

function main() {
  const issues = [];
  let agents;
  try {
    agents = readAgents();
  } catch {
    issues.push(`根 AGENTS.md 不可读: ${AGENTS_PATH}`);
    agents = '';
  }

  // 规则资产: 根 + 嵌套, 双向完整性。
  const referenced = referencedNestedAgents(agents);
  const discovered = agents ? discoveredNestedAgents() : [];
  const referencedSet = new Set(referenced);
  const discoveredSet = new Set(discovered);
  const dangling = referenced.filter((p) => !discoveredSet.has(p));
  const unlisted = discovered.filter((p) => !referencedSet.has(p));
  if (dangling.length > 0) {
    issues.push(`悬空引用 (根 AGENTS.md 引用但文件不存在): ${dangling.join(', ')}`);
  }
  if (unlisted.length > 0) {
    issues.push(`未登记嵌套 AGENTS (文件存在但根 AGENTS.md "Package-local AGENTS" 段未列出): ${unlisted.join(', ')}`);
  }
  const rulesCount = 1 + discovered.length;

  // hook 资产: .husky/pre-commit 存在且挂载 guard-paths。
  const hook = hookCheck();
  if (!hook.ok) issues.push(hook.issue);
  const hooksCount = existsSync(HUSKY_PRECOMMIT) ? 1 : 0;

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({
      status: issues.length === 0 ? 'ok' : 'broken',
      rules: rulesCount,
      hooks: hooksCount,
      nestedAgents: discovered,
      referencedNestedAgents: referenced,
      issues,
    }, null, 2) + '\n');
  } else {
    if (issues.length === 0) {
      console.log(`\x1b[32m[check-agent-assets] OK\x1b[0m — rules=${rulesCount} (root + ${discovered.length} nested), hooks=${hooksCount}, all assets tracked.`);
    } else {
      console.error(`\x1b[31m[check-agent-assets] ${issues.length} asset inventory issue(s):\x1b[0m`);
      for (const issue of issues) console.error(`  \x1b[31m✗\x1b[0m ${issue}`);
      console.error('\x1b[33mUpdate root AGENTS.md "Package-local AGENTS" or restore the missing asset.\x1b[0m\n');
    }
  }
  process.exit(issues.length === 0 ? 0 : 1);
}

main();
