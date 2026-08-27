/**
 * @3dgs/convert 转换性能基准
 *
 * 对可用源文件执行全格式转换, 记录耗时与产物体积:
 *   - ply/kitchen.splat → SPZ / SOG
 *   - ply/demo1.ply    → SPLAT / SPZ / SOG
 *   - ply/demo2.ply    → SPLAT / SPZ / SOG (大文件, 受内存限制时标记失败)
 *
 * 用法: node benchmarks/run-convert-benchmark.mjs
 */

import { spawn } from 'node:child_process';
import { statSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const CLI = join(root, 'packages', 'convert', 'dist', 'cli.js');
const OUT_DIR = join(root, 'ply', 'output');
const REPORT_PATH = join(__dirname, 'reports', 'benchmark-convert-report.md');
const JSON_PATH = join(__dirname, 'reports', 'benchmark-convert-results.json');

/** 转换任务: [输入文件, 子命令, 输出格式] */
const TASKS = [
  ['ply/kitchen.splat', 'splat-to-spz', 'spz'],
  ['ply/kitchen.splat', 'splat-to-sog', 'sog'],
  ['ply/demo1.ply', 'ply-to-splat', 'splat'],
  ['ply/demo1.ply', 'ply-to-spz', 'spz'],
  ['ply/demo1.ply', 'ply-to-sog', 'sog'],
  ['ply/demo2.ply', 'ply-to-splat', 'splat'],
  ['ply/demo2.ply', 'ply-to-spz', 'spz'],
  ['ply/demo2.ply', 'ply-to-sog', 'sog'],
];

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function main() {
  console.log('🔧 @3dgs/convert 转换性能基准\n');

  const results = [];

  for (const [input, cmd, fmt] of TASKS) {
    const inputPath = join(root, input);
    if (!existsSync(inputPath)) {
      console.log(`⚠️ 跳过: ${input} 不存在`);
      continue;
    }

    const inputSize = statSync(inputPath).size;
    const baseName = input.split('/').pop().replace(/\.\w+$/, '');
    const outFile = join(OUT_DIR, `${baseName}-bench.${fmt}`);
    if (existsSync(outFile)) rmSync(outFile);

    console.log(`▶ ${cmd} ${input} (${formatMB(inputSize)} MB)...`);

    // demo2.ply 大文件需要更大堆 (AoS 模型已知限制, 见优化文档 §3.1)
    const isLarge = inputSize > 30 * 1024 * 1024;
    const env = isLarge ? { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } : process.env;

    const start = Date.now();
    const child = spawn(process.execPath, [CLI, cmd, input, '-o', outFile], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ ok: false, ms: Date.now() - start, timedOut: true });
      }, 900000);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, ms: Date.now() - start, timedOut: false });
      });
    });

    const outputSize = existsSync(outFile) ? statSync(outFile).size : 0;
    const splatMatch = stdout.match(/高斯核数:\s*([\d,]+)/);

    results.push({
      input,
      cmd,
      format: fmt,
      inputMB: +formatMB(inputSize),
      outputMB: outputSize ? +formatMB(outputSize) : null,
      ms: outcome.ms,
      ok: outcome.ok,
      timedOut: outcome.timedOut,
      splats: splatMatch ? splatMatch[1] : null,
      error: outcome.ok ? null : (stderr || stdout).split('\n').slice(-3).join(' ').slice(0, 200),
    });

    if (outcome.ok) {
      console.log(
        `  ✅ ${(outcome.ms / 1000).toFixed(1)}s | 产物 ${formatMB(outputSize)} MB | ` +
        `压缩比 ${(inputSize / Math.max(outputSize, 1)).toFixed(2)}×`,
      );
      // 清理产物避免占用磁盘
      rmSync(outFile);
    } else {
      console.log(`  ❌ 失败 (${outcome.timedOut ? '超时' : `${(outcome.ms / 1000).toFixed(1)}s`}): ${results.at(-1).error}`);
    }
  }

  // ── 报告 ──
  const now = new Date().toISOString();
  let md = '# 3DGS 转换管线性能基准报告 (convert)\n\n';
  md += `**测试时间**: ${now}\n`;
  md += `**CLI**: \`packages/convert/dist/cli.js\` (Node ${process.version})\n`;
  md += `**注**: >30MB 输入自动启用 \`NODE_OPTIONS=--max-old-space-size=8192\` (AoS 内存模型已知限制, 见优化文档 §4.6 SoA 改造)\n\n`;
  md += '| 输入 | 大小 (MB) | 转换 | 产物 (MB) | 压缩比 | 耗时 (s) | Splats | 结果 |\n';
  md += '|------|----------|------|----------|--------|---------|--------|------|\n';
  for (const r of results) {
    const ratio = r.outputMB ? (r.inputMB / r.outputMB).toFixed(2) + '×' : '—';
    const status = r.ok ? '✅' : r.timedOut ? '⏱️ 超时' : '❌';
    md += `| ${r.input} | ${r.inputMB} | ${r.cmd} | ${r.outputMB ?? '—'} | ${ratio} | ${(r.ms / 1000).toFixed(1)} | ${r.splats ?? '—'} | ${status} |\n`;
  }

  writeFileSync(REPORT_PATH, md);
  writeFileSync(JSON_PATH, JSON.stringify({ timestamp: now, node: process.version, results }, null, 2));

  console.log(`\n✅ 报告: ${REPORT_PATH}`);
  console.log(`✅ 数据: ${JSON_PATH}`);
}

main().catch((err) => {
  console.error('转换基准失败:', err);
  process.exit(1);
});
