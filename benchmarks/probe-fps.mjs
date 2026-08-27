/**
 * FPS 显示问题诊断探针
 * 1. 独立测量页面真实 RAF 频率 (高频采样)
 * 2. 同步读取 HUD 显示的 FPS
 * 3. 测试场景: 稳态 → 场景切换(加载期) → 恢复
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 150)));

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => window.__benchReady === true, { timeout: 180000 });

// 注入独立 RAF 测量器: 每 1000ms 报告一次真实帧数与帧时间分布
await page.evaluate(() => {
  window.__fpsProbe = { windows: [] };
  let count = 0;
  let last = performance.now();
  let winStart = performance.now();
  const dts = [];
  function tick() {
    const now = performance.now();
    dts.push(now - last);
    last = now;
    count++;
    if (now - winStart >= 1000) {
      const sorted = dts.slice().sort((a, b) => a - b);
      window.__fpsProbe.windows.push({
        frames: count,
        elapsed: Math.round(now - winStart),
        measuredFps: +(count * 1000 / (now - winStart)).toFixed(1),
        dtP50: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
        dtMax: +sorted[sorted.length - 1].toFixed(1),
      });
      count = 0; dts.length = 0; winStart = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});

async function sampleHud(label) {
  await page.waitForTimeout(2500);
  const hud = await page.evaluate(() => document.getElementById('hud')?.innerText || '(空)');
  const probe = await page.evaluate(() => window.__fpsProbe.windows.slice(-2));
  console.log(`\n── ${label} ──`);
  console.log('HUD:', hud.split('\n')[0]);
  for (const w of probe) {
    console.log(`探针: ${w.measuredFps} fps (帧数 ${w.frames}/${w.elapsed}ms, dtP50=${w.dtP50}ms, dtMax=${w.dtMax}ms)`);
  }
}

await sampleHud('稳态 (kitchen 初始)');

// 场景切换 — 加载期
console.log('\n>>> 切换到 demo2 (3.97M splats)...');
await page.evaluate(async () => { await window.__switchScene('demo2'); });
await sampleHud('demo2 加载完成后');

// 切回小场景
console.log('\n>>> 切回 kitchen...');
await page.evaluate(async () => { await window.__switchScene('kitchen'); });
await sampleHud('kitchen 恢复后');

// 模拟页面隐藏/恢复 (visibilitychange)
console.log('\n>>> 模拟页面隐藏 3s 后恢复...');
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(3000);
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(300);
const hudRightAfterResume = await page.evaluate(() => document.getElementById('hud')?.innerText.split('\n')[0]);
console.log('恢复后 300ms HUD:', hudRightAfterResume);
await sampleHud('恢复后 2.8s');

await browser.close();
console.log('\n诊断完成');
