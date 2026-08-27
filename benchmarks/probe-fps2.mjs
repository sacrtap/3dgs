/**
 * FPS 探针 #2 — 高频监视 HUD 文本变化 + 全局 RAF 回调计数
 * 目的: 区分 "HUD 停更(旧值残留)" 与 "计算错误(双份计数等)"
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => window.__benchReady === true, { timeout: 180000 });

// 全局 RAF 回调次数计数 (检测是否存在多个并行 RAF 循环)
await page.evaluate(() => {
  window.__rafStats = { perSecond: [] };
  let count = 0;
  let winStart = performance.now();
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    return origRAF((t) => {
      count++;
      const now = performance.now();
      if (now - winStart >= 1000) {
        window.__rafStats.perSecond.push(count);
        count = 0;
        winStart = now;
      }
      cb(t);
    });
  };
});

// 每 250ms 采样一次 HUD 的 FPS 值
const samples = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(250);
  const row = await page.evaluate(() => {
    const hud = document.getElementById('hud')?.innerText || '';
    const m = hud.match(/FPS: (\d+)/);
    return m ? parseInt(m[1], 10) : null;
  });
  samples.push(row);
}
const raf = await page.evaluate(() => window.__rafStats.perSecond);
console.log('HUD FPS 序列 (每 250ms):', samples.join(' '));
console.log('全局 RAF 回调数/秒 (≥2× 实际帧数说明有多循环):', raf.join(' '));

// 统计 HUD 值的变化次数
let changes = 0;
for (let i = 1; i < samples.length; i++) if (samples[i] !== samples[i - 1]) changes++;
console.log(`HUD 变化次数: ${changes}/${samples.length - 1}`);

await browser.close();
