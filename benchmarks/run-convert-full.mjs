/**
 * @3dgs/convert 全量转换 — 性能与质量测试
 *
 * 对 ply/ 根目录下全部源文件执行目标格式转换, 记录耗时并对每个产物做质量验证:
 *   - .splat: 体积为 32 字节整数倍, splat 数 = 体积/32 = 参考值
 *   - .spz  : 16B header (magic/version/numSplats) 校验, numSplats = 参考值
 *   - .sog  : 64B header (magic/version/numSplats/numChunks) 校验, numSplats = 参考值
 *
 * 参考值来源: .splat 输入 = 体积/32; .ply 输入 = CLI info 解析的高斯核数。
 *
 * 用法: node benchmarks/run-convert-full.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, statSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const CLI = join(root, 'packages', 'convert', 'dist', 'cli.js');
const PLY_DIR = join(root, 'ply');
const OUT_DIR = join(root, 'ply', 'output');
const REPORT_PATH = join(__dirname, 'reports', 'benchmark-convert-full-report.md');
const JSON_PATH = join(__dirname, 'reports', 'benchmark-convert-full-results.json');

const SPZ_MAGIC = 1347635022; // 0x5053474E ("NGSP" LE) — 与 spz-writer.ts 一致
const SOG_MAGIC_V1 = 0x31474f53; // "SOG1"
const SOG_MAGIC_V2 = 0x32474f53; // "SOG2"

/** 转换任务: [输入文件, 目标格式] (ply → splat/spz/sog; splat → spz/sog) */
const TASKS = [
  ['demo1.ply', 'splat'],
  ['demo1.ply', 'spz'],
  ['demo1.ply', 'sog'],
  ['demo2.ply', 'splat'],
  ['demo2.ply', 'spz'],
  ['demo2.ply', 'sog'],
  ['garden.ply', 'splat'],
  ['garden.ply', 'spz'],
  ['garden.ply', 'sog'],
  ['kitchen.splat', 'spz'],
  ['kitchen.splat', 'sog'],
  ['storysplat.splat', 'spz'],
  ['storysplat.splat', 'sog'],
];

function cmdFor(input, fmt) {
  const isPly = input.endsWith('.ply');
  return `${isPly ? 'ply' : 'splat'}-to-${fmt}`;
}

function runProcess(args, env, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, ms: Date.now() - start, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, ms: Date.now() - start, stdout, stderr, timedOut: false });
    });
  });
}

/** 获取输入的参考 splat 数 (缓存) */
const refCountCache = new Map();
async function getReferenceCount(inputPath) {
  if (refCountCache.has(inputPath)) return refCountCache.get(inputPath);

  let count;
  if (inputPath.endsWith('.splat')) {
    count = Math.floor(statSync(inputPath).size / 32);
  } else {
    // CLI info 解析 PLY 高斯核数 (大文件需 8GB 堆, 与转换一致)
    const isLarge = statSync(inputPath).size > 30 * 1024 * 1024;
    const env = isLarge ? { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } : process.env;
    const res = await runProcess(['info', inputPath], env, 600000);
    const m = res.stdout.match(/高斯核数:\s*([\d,]+)/);
    count = m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }
  refCountCache.set(inputPath, count);
  return count;
}

/** 质量验证: 返回 { ok, detail } */
async function validateOutput(outPath, fmt, expectedCount) {
  if (!existsSync(outPath)) return { ok: false, detail: '产物不存在' };

  const size = statSync(outPath).size;
  // ★ 注意 byteOffset: Node readFileSync 的 Buffer 可能来自共享池 (同 D-03 隐患),
  //   DataView 必须带上 byteOffset 才能读到真实文件头部
  const buf = readFileSync(outPath);

  if (fmt === 'splat') {
    if (size % 32 !== 0) return { ok: false, detail: `体积 ${size} 非 32 字节整数倍` };
    const count = size / 32;
    if (expectedCount == null) return { ok: true, detail: `${count.toLocaleString()} splats (无参考值, 结构合法)` };
    return count === expectedCount
      ? { ok: true, detail: `${count.toLocaleString()} splats ✓` }
      : { ok: false, detail: `splat 数 ${count} ≠ 参考值 ${expectedCount}` };
  }

  if (fmt === 'spz') {
    // ★ 权威布局 (2026-08-27 勘误后): 整文件 = 单个 gzip 流,
    //   解压后前 16B 为 header。与 Spark SpzWriter/SpzReader 一致。
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
      return { ok: false, detail: `非整文件 gzip 布局 (首字节 ${buf[0].toString(16)} ${buf[1].toString(16)})` };
    }
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressed = new Uint8Array(await new Response(stream).arrayBuffer());
    if (decompressed.byteLength < 16) return { ok: false, detail: '解压后不足 16 字节' };
    const view = new DataView(decompressed.buffer);
    const magic = view.getUint32(0, true);
    const version = view.getUint32(4, true);
    const numSplats = view.getUint32(8, true);
    const shDegree = view.getUint8(12);
    if (magic !== SPZ_MAGIC) return { ok: false, detail: `magic 不匹配 (0x${magic.toString(16)})` };
    if (version !== 2) return { ok: false, detail: `版本异常 (${version})` };
    if (expectedCount == null) return { ok: true, detail: `v${version}, ${numSplats.toLocaleString()} splats, SH=${shDegree} (无参考值)` };
    if (numSplats !== expectedCount) return { ok: false, detail: `numSplats ${numSplats} ≠ 参考值 ${expectedCount}` };
    return { ok: true, detail: `整文件 gzip, v${version}, ${numSplats.toLocaleString()} splats, SH=${shDegree} ✓` };
  }

  if (fmt === 'sog') {
    const head = new DataView(buf.buffer, buf.byteOffset, Math.min(64, buf.byteLength));
    const magic = head.getUint32(0, true);
    if (magic !== SOG_MAGIC_V1 && magic !== SOG_MAGIC_V2) {
      return { ok: false, detail: `magic 不匹配 (0x${magic.toString(16)})` };
    }
    const numSplats = head.getUint32(8, true);
    const numChunks = head.getUint32(12, true);
    if (expectedCount == null) return { ok: true, detail: `${magic === SOG_MAGIC_V2 ? 'v2' : 'v1'}, ${numSplats.toLocaleString()} splats, ${numChunks} chunks (无参考值)` };
    if (numSplats !== expectedCount) return { ok: false, detail: `numSplats ${numSplats} ≠ 参考值 ${expectedCount}` };
    return { ok: true, detail: `${magic === SOG_MAGIC_V2 ? 'v2' : 'v1'}, ${numSplats.toLocaleString()} splats, ${numChunks} chunks ✓` };
  }

  return { ok: false, detail: `未知格式 ${fmt}` };
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function main() {
  console.log('🔧 @3dgs/convert 全量转换 — 性能与质量测试');
  console.log(`   任务数: ${TASKS.length}\n`);

  const results = [];

  for (const [input, fmt] of TASKS) {
    const inputPath = join(PLY_DIR, input);
    if (!existsSync(inputPath)) {
      console.log(`⚠️ 跳过: ${input} 不存在`);
      continue;
    }

    const baseName = input.replace(/\.\w+$/, '');
    const outFile = join(OUT_DIR, `${baseName}.${fmt}`);
    const inputSize = statSync(inputPath).size;
    const refCount = await getReferenceCount(inputPath);

    console.log(`▶ ${cmdFor(input, fmt)} ${input} (${formatMB(inputSize)} MB, 参考 ${refCount?.toLocaleString()} splats)...`);

    // >30MB 输入启用 8GB 堆 (AoS 内存模型已知限制)
    const isLarge = inputSize > 30 * 1024 * 1024;
    const env = isLarge ? { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } : process.env;

    const outcome = await runProcess(
      [cmdFor(input, fmt), inputPath, '-o', outFile],
      env,
      20 * 60 * 1000, // 20 分钟超时保护
    );

    if (!outcome.ok) {
      const errTail = (outcome.stderr || outcome.stdout).split('\n').slice(-3).join(' ').slice(0, 200);
      results.push({ input, fmt, ok: false, timedOut: outcome.timedOut, ms: outcome.ms, error: errTail });
      const dur = (outcome.ms / 1000).toFixed(1) + 's';
      const reason = outcome.timedOut ? '超时' : dur;
      console.log('  ❌ 转换失败 (' + reason + '): ' + errTail);
      continue;
    }

    // ── 质量验证 ──
    const validation = await validateOutput(outFile, fmt, refCount);
    const outputSize = statSync(outFile).size;

    results.push({
      input,
      fmt,
      ok: validation.ok,
      ms: outcome.ms,
      inputMB: +formatMB(inputSize),
      outputMB: +formatMB(outputSize),
      ratio: +(inputSize / outputSize).toFixed(2),
      refCount,
      quality: validation.detail,
    });

    const icon = validation.ok ? '✅' : '⚠️';
    const durStr = (outcome.ms / 1000).toFixed(1) + 's';
    const ratioStr = (inputSize / outputSize).toFixed(2) + 'x';
    console.log(
      `  ${icon} ${durStr} | ${formatMB(outputSize)} MB (${ratioStr}) | 质量: ${validation.detail}`,
    );
  }

  // ── 报告 ──
  const now = new Date().toISOString();
  const passed = results.filter((r) => r.ok).length;

  let md = '# 3DGS 全量转换性能与质量测试报告 (convert)\n\n';
  md += `**测试时间**: ${now}\n`;
  md += `**范围**: \`ply/\` 根目录全部源文件 (3 PLY + 2 SPLAT) → 目标格式, 共 ${TASKS.length} 组任务\n`;
  md += `**结果**: ${passed}/${results.length} 组通过 (转换成功 + 质量验证)\n`;
  md += `**注**: >30MB 输入启用 \`NODE_OPTIONS=--max-old-space-size=8192\`\n\n`;
  md += '| 输入 | 输入 (MB) | 参考 Splats | 转换 | 产物 (MB) | 压缩比 | 耗时 (s) | 质量验证 |\n';
  md += '|------|----------|------------|------|----------|--------|---------|----------|\n';
  for (const r of results) {
    const cmd = r.ok || r.ms ? cmdFor(r.input, r.fmt) : cmdFor(r.input, r.fmt);
    if (!r.ok && !r.outputMB) {
      md += `| ${r.input} | ${formatMB(statSync(join(PLY_DIR, r.input)).size)} | — | ${cmd} | — | — | ${(r.ms / 1000).toFixed(1)} | ❌ ${r.timedOut ? '超时' : '失败'} |\n`;
    } else {
      md += `| ${r.input} | ${r.inputMB} | ${r.refCount?.toLocaleString()} | ${cmd} | ${r.outputMB} | ${r.ratio}× | ${(r.ms / 1000).toFixed(1)} | ${r.ok ? '✅' : '❌'} ${r.quality} |\n`;
    }
  }

  writeFileSync(REPORT_PATH, md);
  writeFileSync(JSON_PATH, JSON.stringify({ timestamp: now, node: process.version, results }, null, 2));

  console.log(`\n${'='.repeat(56)}`);
  console.log(`✅ ${passed}/${results.length} 通过`);
  console.log(`✅ 报告: ${REPORT_PATH}`);

  // 列出最终产物
  console.log('\n产物清单 (ply/output):');
  for (const f of readdirSync(OUT_DIR).sort()) {
    const s = statSync(join(OUT_DIR, f));
    console.log(`   ${f.padEnd(28)} ${formatMB(s.size)} MB`);
  }

  if (passed < results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('全量转换测试失败:', err);
  process.exit(1);
});
