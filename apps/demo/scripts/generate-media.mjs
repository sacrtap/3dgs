/**
 * 生成 demo 空间媒体演示资产 (无需外部素材):
 *   - public/demo-photo.png : Canvas 绘制的示例图片
 *   - public/demo-video.webm: Canvas 动画经 MediaRecorder 录制的循环视频
 *
 * 用法: node apps/demo/scripts/generate-media.mjs  (Playwright headless)
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url))); // apps/demo
const PUBLIC = join(root, 'public');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

// ── 1. 生成示例图片 (1280×720 渐变 + 网格 + 文字) ──
const pngBuffer = await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  // 背景渐变
  const grad = ctx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, '#1a2f5c');
  grad.addColorStop(0.5, '#3d6b8e');
  grad.addColorStop(1, '#8a5a3c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1280, 720);

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1280; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 720); ctx.stroke();
  }
  for (let y = 0; y <= 720; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1280, y); ctx.stroke();
  }

  // 装饰圆
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(160 + i * 140, 360 + Math.sin(i) * 120, 40 + (i % 3) * 20, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${i * 45}, 70%, 60%, 0.35)`;
    ctx.fill();
  }

  // 文字
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 56px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('3DGS 空间图像嵌入', 640, 330);
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Image embedded in Gaussian scene', 640, 390);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
});
writeFileSync(join(PUBLIC, 'demo-photo.png'), Buffer.from(pngBuffer));
console.log('✅ public/demo-photo.png 生成完成');

// ── 2. 录制示例视频 (640×360, 3 秒循环动画 → webm) ──
const videoBuffer = await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');

  const stream = canvas.captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const duration = 3000;
  const start = performance.now();

  recorder.start(200);

  await new Promise((resolve) => {
    function draw() {
      const t = (performance.now() - start) / duration;
      if (t >= 1) { resolve(); return; }

      // 旋转渐变背景
      const hue = (t * 360) % 360;
      const grad = ctx.createLinearGradient(0, 0, 640, 360);
      grad.addColorStop(0, `hsl(${hue}, 65%, 25%)`);
      grad.addColorStop(1, `hsl(${(hue + 120) % 360}, 65%, 45%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 360);

      // 弹跳球
      const bx = 320 + Math.sin(t * Math.PI * 4) * 220;
      const by = 180 - Math.abs(Math.sin(t * Math.PI * 6)) * 120;
      ctx.beginPath();
      ctx.arc(bx, by, 36, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 220, 120, 0.95)';
      ctx.fill();

      // 文字
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('3DGS 空间视频', 320, 60);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText('Video playing in scene space', 320, 330);

      requestAnimationFrame(draw);
    }
    draw();
  });

  recorder.stop();
  await new Promise((r) => { recorder.onstop = r; });

  const blob = new Blob(chunks, { type: 'video/webm' });
  return new Uint8Array(await blob.arrayBuffer());
});
writeFileSync(join(PUBLIC, 'demo-video.webm'), Buffer.from(videoBuffer));
console.log('✅ public/demo-video.webm 生成完成');

await browser.close();
console.log('🎉 媒体资产生成完毕');
