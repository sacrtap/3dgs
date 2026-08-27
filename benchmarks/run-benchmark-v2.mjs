/**
 * 3DGS 性能基准自动化测试脚本 (v2)
 *
 * 针对当前可用的场景数据 (kitchen, 248K splats) 遍历 SPLAT/SPZ/SOG 三种格式,
 * 采集加载时间、FPS (Avg/P50/P5)、帧时间 (P95/Max)、丢帧率等指标,
 * 生成 Markdown 报告与 JSON 数据。
 *
 * 用法:
 *   1. pnpm build && (cd apps/demo && npx vite preview --port 4173)
 *   2. node benchmarks/run-benchmark-v2.mjs [--headed]
 *
 * 说明: 复用 demo 暴露的自动化接口 (__switchFormat/__runBench/__getDeviceInfo)。
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_URL = process.env.DEMO_URL || 'http://localhost:4173/';
const REPORT_PATH = join(__dirname, 'reports', 'benchmark-format-report.md');
const JSON_PATH = join(__dirname, 'reports', 'benchmark-format-results.json');
const BENCH_DURATION = 10000; // 10s 采样
const FORMATS = ['splat', 'spz', 'sog'];
const HEADED = process.argv.includes('--headed');

function formatNum(n, decimals = 1) {
  return typeof n === 'number' && isFinite(n) ? n.toFixed(decimals) : '—';
}

async function main() {
  console.log('🚀 3DGS 各格式性能基准测试 (v2)\n');
  console.log(`   URL: ${DEMO_URL}`);
  console.log(`   格式: ${FORMATS.join(', ')}`);
  console.log(`   采样时长: ${BENCH_DURATION / 1000}s/格式`);
  console.log(`   模式: ${HEADED ? 'headed (真实 GPU)' : 'headless (软件渲染, 相对比较)'}\n`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      '--enable-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--window-size=1280,800',
    ],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  console.log('📡 导航到 Demo...');
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__benchReady === true, { timeout: 120000 });
  console.log('  ✅ 渲染器已就绪 (初始场景: kitchen, 格式: splat)\n');

  // ── 设备信息 ──
  const deviceInfo = await page.evaluate(() => window.__getDeviceInfo());
  const webgpuCap = await page.evaluate(() => {
    const cap = window.__webgpuCapability;
    return cap ? { supported: cap.supported, reason: cap.reason, gpuType: cap.gpuType } : null;
  });

  console.log('📊 设备信息:');
  console.log(`   Backend: ${deviceInfo.backend} | Tier: ${deviceInfo.deviceTier}`);
  console.log(`   GPU: ${deviceInfo.gpu}`);
  console.log(`   SAB: ${deviceInfo.sab ? '✓' : '✗'} | ResScale: ${(deviceInfo.resolutionScale * 100).toFixed(0)}%`);
  console.log(`   WebGPU: ${webgpuCap?.supported ? `✓ ${webgpuCap.gpuType ?? ''}` : `✗ ${webgpuCap?.reason ?? '未检测'}`}\n`);

  // ── 逐格式测试 ──
  const results = [];

  for (const fmt of FORMATS) {
    console.log(`\n${'='.repeat(56)}`);
    console.log(`▶ 测试格式: ${fmt.toUpperCase()}`);

    try {
      // __switchFormat: 切换 + 3s 稳定 + 等待 LOD 就绪
      const ok = await page.evaluate(async (f) => window.__switchFormat(f), fmt);
      if (!ok) {
        results.push({ format: fmt, error: '格式不可用' });
        console.log('  ⚠️ 格式不可用, 跳过');
        continue;
      }

      const loadTime = await page.evaluate(() => window.__bench.loadTime);
      console.log(`  加载完成: ${Math.round(loadTime)} ms`);

      // __runBench: 采样帧时间
      const stats = await page.evaluate((d) => window.__runBench(d), BENCH_DURATION);

      if (stats) {
        results.push({
          format: fmt.toUpperCase(),
          splatCount: stats.splatCount,
          loadTime: Math.round(loadTime),
          fpsAvg: stats.fpsAvg,
          fpsP50: stats.fpsP50,
          fpsP5: stats.fpsP5,
          frameTimeP95: stats.ftP95,
          frameTimeMax: stats.ftMax,
          frameTimeStd: stats.ftStd,
          dropRate: stats.dropRate,
          sampleCount: stats.sampleCount,
        });
        console.log(
          `  FPS: avg=${formatNum(stats.fpsAvg)} P50=${formatNum(stats.fpsP50)} P5=${formatNum(stats.fpsP5)} | ` +
          `P95=${formatNum(stats.ftP95)}ms Max=${formatNum(stats.ftMax)}ms 丢帧=${formatNum(stats.dropRate)}%`,
        );
      } else {
        results.push({ format: fmt.toUpperCase(), loadTime: Math.round(loadTime), error: '采样无数据' });
        console.log('  ⚠️ 采样无数据');
      }
    } catch (err) {
      results.push({ format: fmt.toUpperCase(), error: err.message });
      console.log(`  ❌ 失败: ${err.message}`);
    }
  }

  await browser.close();

  // ── 报告 ──
  const now = new Date().toISOString();
  let md = '# 3DGS 各格式性能基准报告 (v2 自动化)\n\n';
  md += `**测试时间**: ${now}\n\n`;
  md += `**环境**: ${HEADED ? 'headed 浏览器 (真实 GPU)' : 'headless Chromium (软件渲染 — 绝对值仅供格式间相对比较)'}\n`;
  md += `**后端**: ${deviceInfo.backend} | **设备分级**: ${deviceInfo.deviceTier} | **GPU**: ${deviceInfo.gpu}\n`;
  md += `**SAB**: ${deviceInfo.sab ? '✓' : '✗'} | **初始分辨率缩放**: ${(deviceInfo.resolutionScale * 100).toFixed(0)}%\n`;
  md += `**场景**: Kitchen (248K splats) | **采样**: 每格式 ${BENCH_DURATION / 1000}s\n\n`;

  md += '## 测试结果\n\n';
  md += '| 格式 | 加载时间 (ms) | FPS Avg | FPS P50 | FPS P5 | 帧时间 P95 (ms) | 帧时间 Max (ms) | 帧时间 σ | 丢帧率 (%) | 采样数 |\n';
  md += '|------|-------------|---------|---------|--------|----------------|----------------|---------|-----------|--------|\n';
  for (const r of results) {
    if (r.error) {
      md += `| ${r.format.toUpperCase()} | — | — | — | — | — | — | — | — | (${r.error}) |\n`;
    } else {
      md += `| ${r.format} | ${r.loadTime} | ${formatNum(r.fpsAvg)} | ${formatNum(r.fpsP50)} | ${formatNum(r.fpsP5)} | ${formatNum(r.frameTimeP95)} | ${formatNum(r.frameTimeMax)} | ${formatNum(r.frameTimeStd)} | ${formatNum(r.dropRate)} | ${r.sampleCount} |\n`;
    }
  }

  if (consoleErrors.length > 0) {
    md += '\n## 浏览器控制台错误 (测试期间)\n\n';
    for (const e of consoleErrors.slice(0, 10)) {
      md += `- \`${e.slice(0, 200)}\`\n`;
    }
  }

  writeFileSync(REPORT_PATH, md);
  writeFileSync(JSON_PATH, JSON.stringify({ timestamp: now, deviceInfo, webgpuCap, results }, null, 2));

  console.log(`\n${'='.repeat(56)}`);
  console.log(`✅ 报告: ${REPORT_PATH}`);
  console.log(`✅ 数据: ${JSON_PATH}`);
}

main().catch((err) => {
  console.error('基准测试失败:', err);
  process.exit(1);
});
