/**
 * 3DGS 全量渲染性能基准 (5 场景 × 可用格式)
 *
 * 依赖 demo 暴露的自动化接口: __sceneData / __switchScene / __switchFormat / __runBench。
 * 对每个场景的每种可用格式执行: 切换 + 稳定 + 10s 采样, 采集加载时间、
 * FPS (Avg/P50/P5)、帧时间 (P95/Max/σ)、丢帧率, 生成 Markdown + JSON 报告。
 *
 * 用法:
 *   1. pnpm build && (cd apps/demo && npx vite preview --port 4173)
 *   2. node benchmarks/run-benchmark-full.mjs [--headed]
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_URL = process.env.DEMO_URL || 'http://localhost:4173/';
const REPORT_PATH = join(__dirname, 'reports', 'benchmark-full-report.md');
const JSON_PATH = join(__dirname, 'reports', 'benchmark-full-results.json');
const BENCH_DURATION = 10000; // 10s 采样/组合
const FORMATS = ['ply', 'splat', 'spz', 'sog'];
const HEADED = process.argv.includes('--headed');

function formatNum(n, decimals = 1) {
  return typeof n === 'number' && isFinite(n) ? n.toFixed(decimals) : '—';
}

async function main() {
  console.log('🚀 3DGS 全量渲染性能基准 (5 场景 × 可用格式)\n');
  console.log(`   URL: ${DEMO_URL}`);
  console.log(`   采样: ${BENCH_DURATION / 1000}s/组合`);
  console.log(`   模式: ${HEADED ? 'headed (真实 GPU)' : 'headless (相对比较)'}\n`);

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
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  console.log('📡 导航到 Demo...');
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__benchReady === true, { timeout: 180000 });

  const deviceInfo = await page.evaluate(() => window.__getDeviceInfo());
  const sceneMap = await page.evaluate(() => {
    const out = {};
    for (const [id, s] of Object.entries(window.__sceneData)) {
      out[id] = {
        title: s.title,
        splatCount: s.splatCount,
        formats: Object.fromEntries(Object.entries(s.formats).map(([k, v]) => [k, Boolean(v.url)])),
      };
    }
    return out;
  });

  console.log('📊 设备信息:');
  console.log(`   Backend: ${deviceInfo.backend} | Tier: ${deviceInfo.deviceTier} | GPU: ${deviceInfo.gpu}`);
  console.log(`   SAB: ${deviceInfo.sab ? '✓' : '✗'} | ResScale: ${(deviceInfo.resolutionScale * 100).toFixed(0)}%\n`);

  const results = [];
  const sceneIds = Object.keys(sceneMap);

  for (const sceneId of sceneIds) {
    const scene = sceneMap[sceneId];
    console.log(`${'='.repeat(60)}\n▶ 场景: ${scene.title} (${scene.splatCount})\n${'='.repeat(60)}`);

    // 切换到该场景
    try {
      await page.evaluate(async (id) => { await window.__switchScene(id); }, sceneId);
    } catch (err) {
      console.log(`  ❌ 场景切换失败: ${err.message}`);
      results.push({ scene: scene.title, splatCount: scene.splatCount, format: '—', error: '场景切换失败: ' + err.message });
      continue;
    }

    for (const fmt of FORMATS) {
      if (!scene.formats[fmt]) continue;

      try {
        console.log(`  ▶ ${fmt.toUpperCase()}...`);
        const ok = await page.evaluate(async (f) => window.__switchFormat(f), fmt);
        if (!ok) {
          results.push({ scene: scene.title, splatCount: scene.splatCount, format: fmt.toUpperCase(), error: '格式不可用' });
          console.log('    ⚠️ 格式不可用');
          continue;
        }

        const loadTime = await page.evaluate(() => window.__bench.loadTime);
        const stats = await page.evaluate((d) => window.__runBench(d), BENCH_DURATION);

        if (stats) {
          results.push({
            scene: scene.title,
            splatCount: scene.splatCount,
            format: fmt.toUpperCase(),
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
            `    加载 ${Math.round(loadTime)}ms | FPS P50=${formatNum(stats.fpsP50)} P5=${formatNum(stats.fpsP5)} | ` +
            `P95=${formatNum(stats.ftP95)}ms 丢帧=${formatNum(stats.dropRate)}%`,
          );
        } else {
          results.push({ scene: scene.title, splatCount: scene.splatCount, format: fmt.toUpperCase(), loadTime: Math.round(loadTime), error: '采样无数据' });
          console.log('    ⚠️ 采样无数据');
        }
      } catch (err) {
        results.push({ scene: scene.title, splatCount: scene.splatCount, format: fmt.toUpperCase(), error: err.message.slice(0, 200) });
        console.log(`    ❌ ${err.message.slice(0, 120)}`);
      }
    }
  }

  await browser.close();

  // ── 报告 ──
  const now = new Date().toISOString();
  let md = '# 3DGS 全量渲染性能基准报告 (5 场景 × 可用格式)\n\n';
  md += `**测试时间**: ${now}\n\n`;
  md += `**环境**: ${HEADED ? 'headed (真实 GPU)' : 'headless Chromium (软件渲染 — 绝对值仅供相对比较)'}\n`;
  md += `**后端**: ${deviceInfo.backend} | **设备分级**: ${deviceInfo.deviceTier} | **GPU**: ${deviceInfo.gpu}\n`;
  md += `**SAB**: ${deviceInfo.sab ? '✓' : '✗'} | **初始分辨率缩放**: ${(deviceInfo.resolutionScale * 100).toFixed(0)}%\n`;
  md += `**采样**: 每组合 ${BENCH_DURATION / 1000}s\n\n`;

  md += '## 测试结果总表\n\n';
  md += '| 场景 | Splats | 格式 | 加载 (ms) | FPS Avg | FPS P50 | FPS P5 | 帧时间 P95 (ms) | 帧时间 Max (ms) | 丢帧率 (%) | 采样数 |\n';
  md += '|------|--------|------|----------|---------|---------|--------|----------------|----------------|-----------|--------|\n';
  for (const r of results) {
    if (r.error) {
      md += `| ${r.scene} | ${r.splatCount} | ${r.format} | — | — | — | — | — | — | — | (${r.error.slice(0, 60)}) |\n`;
    } else {
      md += `| ${r.scene} | ${r.splatCount} | ${r.format} | ${r.loadTime} | ${formatNum(r.fpsAvg)} | ${formatNum(r.fpsP50)} | ${formatNum(r.fpsP5)} | ${formatNum(r.frameTimeP95)} | ${formatNum(r.frameTimeMax)} | ${formatNum(r.dropRate)} | ${r.sampleCount} |\n`;
    }
  }

  // 分场景格式对比
  md += '\n## 分场景格式对比 (FPS P50)\n\n';
  md += '| 场景 | PLY | SPLAT | SPZ | SOG |\n';
  md += '|------|-----|-------|-----|-----|\n';
  for (const sceneId of sceneIds) {
    const scene = sceneMap[sceneId];
    const cells = FORMATS.map((fmt) => {
      const r = results.find((x) => x.scene === scene.title && x.format === fmt.toUpperCase() && !x.error);
      return r ? formatNum(r.fpsP50) : '—';
    });
    md += `| ${scene.title} (${scene.splatCount}) | ${cells.join(' | ')} |\n`;
  }

  if (consoleErrors.length > 0) {
    md += '\n## 浏览器控制台错误 (去重, 最多 10 条)\n\n';
    const uniq = Array.from(new Set(consoleErrors)).slice(0, 10);
    for (const e of uniq) {
      md += `- \`${e.slice(0, 200)}\`\n`;
    }
  }

  writeFileSync(REPORT_PATH, md);
  writeFileSync(JSON_PATH, JSON.stringify({ timestamp: now, deviceInfo, results }, null, 2));

  const okCount = results.filter((r) => !r.error).length;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ 完成 ${okCount}/${results.length} 组`);
  console.log(`✅ 报告: ${REPORT_PATH}`);
  console.log(`✅ 数据: ${JSON_PATH}`);
}

main().catch((err) => {
  console.error('基准测试失败:', err);
  process.exit(1);
});
