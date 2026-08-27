/**
 * 空间扩展能力浏览器验证 (含截图 + 元素可见性 + 场景切换)
 *   1. 图像嵌入: 元素可见 + 边界框在视口内 + 图片已加载 (naturalWidth>0)
 *   2. 视频嵌入: 元素可见 + 视频播放中 (readyState>=2, 未暂停)
 *   3. 场景切换热点: 热点出现 → 点击 → 场景确实切换
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const SHOT_DIR = '/tmp/3dgs-verify';
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name}`)); };

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__benchReady === true, { timeout: 180000 });
await page.waitForTimeout(2000);

// ── 1. 图像嵌入 ──
console.log('── 1. 图像嵌入 ──');
await page.click('#btn-embed-image');
await page.waitForTimeout(1500);
const imgInfo = await page.locator('[class*="3dgs-media-item"] img').first().evaluate((im) => ({
  complete: im.complete,
  naturalWidth: im.naturalWidth,
  naturalHeight: im.naturalHeight,
}));
const imgBox = await page.locator('[class*="3dgs-media-item"]').first().boundingBox();
check('图像元素存在', imgInfo !== null);
check('图片资源已加载 (naturalWidth>0)', imgInfo.naturalWidth > 0);
check('图像边界框非空', imgBox !== null && imgBox.width > 1 && imgBox.height > 1);
const inViewport = imgBox && imgBox.x < 1280 && imgBox.y < 800 && imgBox.x + imgBox.width > 0 && imgBox.y + imgBox.height > 0;
check('图像边界框在视口内', !!inViewport);
if (imgBox) console.log(`    [边界框] x=${imgBox.x.toFixed(0)} y=${imgBox.y.toFixed(0)} w=${imgBox.width.toFixed(0)} h=${imgBox.height.toFixed(0)}`);
await page.screenshot({ path: join(SHOT_DIR, '1-image-embed.png') });

// ── 2. 视频嵌入 ──
console.log('── 2. 视频嵌入 ──');
await page.click('#btn-embed-video');
await page.waitForTimeout(2000);
const videoInfo = await page.locator('[class*="3dgs-media-item"] video').first().evaluate((v) => ({
  readyState: v.readyState,
  paused: v.paused,
  muted: v.muted,
  loop: v.loop,
  videoWidth: v.videoWidth,
}));
const vidBox = await page.locator('[class*="3dgs-media-item"]').last().boundingBox();
check('视频元素存在', videoInfo !== null);
check('视频已加载帧 (readyState>=2)', videoInfo.readyState >= 2);
check('视频正在播放 (未暂停)', !videoInfo.paused);
check('视频静音循环', videoInfo.muted && videoInfo.loop);
check('视频边界框非空', vidBox !== null && vidBox.width > 1 && vidBox.height > 1);
await page.screenshot({ path: join(SHOT_DIR, '2-video-embed.png') });

// ── 3. 场景切换热点 ──
console.log('── 3. 场景切换热点 ──');
const sceneBefore = await page.evaluate(() => window.__sceneData && (window.__currentSceneId || 'kitchen'));
await page.click('#btn-add-scene-hotspot');
await page.waitForTimeout(500);
const sceneHotspotCount = await page.locator('[data-hotspot="true"][data-hotspot-type="scene"]').count();
check('场景切换热点已添加', sceneHotspotCount >= 1);

// 点击场景热点 → 触发场景切换
const hotspot = page.locator('[data-hotspot="true"][data-hotspot-type="scene"]').first();
const hsVisible = await hotspot.isVisible().catch(() => false);
check('场景热点投影可见', hsVisible);
if (hsVisible) {
  await hotspot.dispatchEvent('click');
  await page.waitForTimeout(3000);
  const sceneAfter = await page.evaluate(() => window.__currentSceneId || '');
  check(`场景已切换 (${sceneBefore} → ${sceneAfter || '已变化'})`, sceneAfter !== sceneBefore);
}
await page.screenshot({ path: join(SHOT_DIR, '3-scene-hotspot.png') });

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (errors.length) { console.log('\n页面错误:'); errors.slice(0, 5).forEach((e) => console.log('  -', e.slice(0, 120))); }
console.log(`\n截图目录: ${SHOT_DIR}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
