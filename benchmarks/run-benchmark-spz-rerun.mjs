/**
 * SPZ 修复验证专项基准 — 修复后重跑 5 场景 × SPZ
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_URL = process.env.DEMO_URL || 'http://localhost:4173/';
const REPORT_PATH = join(__dirname, 'reports', 'benchmark-spz-rerun-results.json');
const BENCH_DURATION = 10000;

function formatNum(n, decimals = 1) {
  return typeof n === 'number' && isFinite(n) ? n.toFixed(decimals) : '—';
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--window-size=1280,800'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => window.__benchReady === true, { timeout: 180000 });

const deviceInfo = await page.evaluate(() => window.__getDeviceInfo());
console.log(`设备: ${deviceInfo.backend} | ${deviceInfo.deviceTier} | ${deviceInfo.gpu}\n`);

const sceneMap = await page.evaluate(() => {
  const out = {};
  for (const [id, s] of Object.entries(window.__sceneData)) {
    out[id] = { title: s.title, splatCount: s.splatCount };
  }
  return out;
});

const results = [];
for (const [sceneId, scene] of Object.entries(sceneMap)) {
  console.log(`▶ ${scene.title} (${scene.splatCount}) → SPZ`);
  try {
    await page.evaluate(async (id) => { await window.__switchScene(id); }, sceneId);
    const ok = await page.evaluate(async () => window.__switchFormat('spz'));
    if (!ok) {
      results.push({ scene: scene.title, format: 'SPZ', error: '格式不可用' });
      continue;
    }
    const loadTime = await page.evaluate(() => window.__bench.loadTime);
    const stats = await page.evaluate((d) => window.__runBench(d), BENCH_DURATION);
    if (stats) {
      results.push({
        scene: scene.title, splatCount: scene.splatCount, format: 'SPZ',
        loadTime: Math.round(loadTime), fpsAvg: stats.fpsAvg, fpsP50: stats.fpsP50,
        fpsP5: stats.fpsP5, frameTimeP95: stats.ftP95, frameTimeMax: stats.ftMax,
        frameTimeStd: stats.ftStd, dropRate: stats.dropRate, sampleCount: stats.sampleCount,
      });
      console.log(`  加载 ${Math.round(loadTime)}ms | P50=${formatNum(stats.fpsP50)} P5=${formatNum(stats.fpsP5)} | P95=${formatNum(stats.ftP95)}ms 丢帧=${formatNum(stats.dropRate)}%`);
    } else {
      results.push({ scene: scene.title, format: 'SPZ', loadTime: Math.round(loadTime), error: '采样无数据' });
    }
  } catch (err) {
    results.push({ scene: scene.title, format: 'SPZ', error: String(err.message).slice(0, 200) });
    console.log(`  ❌ ${String(err.message).slice(0, 120)}`);
  }
}

await browser.close();
writeFileSync(REPORT_PATH, JSON.stringify({ timestamp: new Date().toISOString(), deviceInfo, results, consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 10) }, null, 2));

const okCount = results.filter((r) => !r.error).length;
console.log(`\n✅ SPZ 重跑完成 ${okCount}/${results.length} | 控制台错误 ${consoleErrors.length} 条`);
console.log(`✅ 数据: ${REPORT_PATH}`);
