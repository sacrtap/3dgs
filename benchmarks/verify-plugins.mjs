/**
 * 插件能力功能验证 (Playwright):
 *   1. 热点添加 + 点击弹出面板
 *   2. 图像嵌入 (空间定位 + 融合样式)
 *   3. 视频嵌入 (空间播放)
 *   4. Shader 预设生效
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__benchReady === true, { timeout: 180000 });
await page.waitForTimeout(1500);

console.log('── 1. 热点添加 + 弹出 ──');
await page.click('#btn-add-hotspot');
await page.waitForTimeout(300);
const hotspotCount = await page.locator('[data-hotspot="true"]').count();
check('热点已添加到叠加层', hotspotCount >= 1);

// 热点应可见 (相机前方 2.5m)
const hotspotVisible = await page.locator('[data-hotspot="true"]').first().isVisible().catch(() => false);
check('热点投影可见', hotspotVisible);

// 点击热点 → 弹出面板
await page.locator('[data-hotspot="true"]').first().click({ force: true });
await page.waitForTimeout(300);
const popupCount = await page.locator('[class*="3dgs-popup-panel"]').count();
check('点击后弹出面板出现', popupCount === 1);
const popupTitle = await page.locator('[class*="3dgs-popup-panel"]').textContent().catch(() => '');
check('弹出面板含标题内容', popupTitle.includes('动态热点'));
const popupImg = await page.locator('[class*="3dgs-popup-panel"] img').count();
check('弹出面板内嵌图片', popupImg === 1);

// 点击遮罩关闭
await page.locator('[class*="3dgs-popup-overlay"]').first().dispatchEvent('click');
await page.waitForTimeout(300);
const popupAfterClose = await page.locator('[class*="3dgs-popup-panel"]').count();
check('点击遮罩关闭弹出面板', popupAfterClose === 0);

console.log('── 2. 图像嵌入 ──');
await page.click('#btn-embed-image');
await page.waitForTimeout(800);
const mediaImg = await page.locator('[class*="3dgs-media-item"] img').count();
check('图像元素已嵌入', mediaImg === 1);
const imgTransform = await page.locator('[class*="3dgs-media-item"]').first().evaluate((el) => el.style.transform);
check('图像带 matrix3d 空间变换', imgTransform.includes('matrix3d'));
const imgOpacity = await page.locator('[class*="3dgs-media-item"]').first().evaluate((el) => el.style.opacity);
check('图像融合透明度已应用', imgOpacity !== '' && parseFloat(imgOpacity) > 0);

console.log('── 3. 视频嵌入 ──');
await page.click('#btn-embed-video');
await page.waitForTimeout(1500);
const mediaVideo = await page.locator('[class*="3dgs-media-item"] video').count();
check('视频元素已嵌入', mediaVideo === 1);
const videoState = await page.locator('[class*="3dgs-media-item"] video').first().evaluate((v) => ({
  paused: v.paused,
  muted: v.muted,
  loop: v.loop,
  readyState: v.readyState,
}));
check('视频自动播放中 (静音循环)', !videoState.paused && videoState.muted && videoState.loop);

// 点击视频暂停
await page.locator('[class*="3dgs-media-item"] video').first().dispatchEvent('click');
await page.waitForTimeout(300);
const pausedAfterClick = await page.locator('[class*="3dgs-media-item"] video').first().evaluate((v) => v.paused);
check('点击视频可暂停', pausedAfterClick);

console.log('── 4. 清除媒体 ──');
await page.click('#btn-clear-embeds');
await page.waitForTimeout(300);
const mediaAfterClear = await page.locator('[class*="3dgs-media-item"]').count();
check('清除后媒体元素为空', mediaAfterClear === 0);

console.log('── 5. Shader 预设 ──');
// 打开 shader 面板需要场景加载完成 (load 事件) — 已由 __benchReady 保证
const presetRows = await page.locator('.shader-toggle-row').count();
check(`Shader 面板含 8 个效果 (含预设)`, presetRows === 8);

// 点击"复古色调"预设
await page.locator('.shader-toggle-row', { hasText: '复古色调' }).click();
await page.waitForTimeout(500);
const presetActive = await page.locator('.shader-toggle-row.active', { hasText: '复古色调' }).count();
check('预设可启用', presetActive === 1);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (errors.length > 0) {
  console.log('\n控制台错误:');
  for (const e of errors.slice(0, 5)) console.log('  -', e.slice(0, 150));
}

await browser.close();
process.exit(fail > 0 ? 1 : 0);
