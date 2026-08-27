/**
 * SPZ 加载失败聚焦诊断探针
 * 切换 kitchen → SPZ, 采集全部控制台消息与页面错误, 定位失败环节。
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

page.on('console', (msg) => {
  const loc = msg.location();
  console.log(`[console:${msg.type()}] ${msg.text().slice(0, 300)}${loc.url ? ` @ ${loc.url.split('/').pop()}:${loc.lineNumber}` : ''}`);
});
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 400)));

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => window.__benchReady === true, { timeout: 120000 });
console.log('=== bench ready, switching to SPZ ===');

const start = Date.now();
try {
  await page.evaluate(() => window.__renderer.loadScene('/kitchen.spz', {
    onProgress: (l, t) => console.log(`__probe progress ${l}/${t}`),
  }), );
  console.log(`=== loadScene resolved in ${Date.now() - start}ms ===`);
} catch (err) {
  console.log(`=== loadScene REJECTED after ${Date.now() - start}ms: ${String(err).slice(0, 200)} ===`);
}

await page.waitForTimeout(2000);
await browser.close();
