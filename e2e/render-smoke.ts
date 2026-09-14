/**
 * renderer 主路径最小 browser E2E (render smoke)
 *
 * ★ 行为证据缺口补充: renderer-three 核心失败路径 (context lost / SOG 流式降级 /
 *   SPZ 回退 / LOD 树降级) 在 jsdom 单元层只能触及 console 提示, 无真实
 *   WebGL 上下文的第二层行为证据。本脚本在真实 Chromium 中加载 demo 场景
 *   (kitchen.splat), 断言:
 *     1. 渲染器挂载成功 — #viewer canvas 出现
 *     2. 首帧渲染 — 渲染循环持续输出帧且 canvas 像素非空
 *     3. 无控制台错误与未捕获异常 — 主路径干净加载
 *
 * 设计要点 (调试验证过):
 *   - 帧采集用 addInitScript 独立 RAF (与 benchmark.ts 同款字符串形式,
 *     避免 esbuild __name 注入浏览器上下文); 该阶段绝不触碰 canvas 的
 *     getContext, 否则会抢占 Spark 的上下文创建导致首帧失败。
 *   - 像素采样放到 loading 隐藏后的 page.evaluate 内 (WebGL 上下文已是
 *     Spark 所有, readPixels 可复用同一上下文), preserveDrawingBuffer:false
 *     下 rAF 回调内读取上一帧内容, 多帧采样只要有任一帧非空即通过。
 *   - 只断言"能渲染"不断言"渲染多快" — 帧率门禁属 benchmarks/benchmark.ts
 *     --gate (P50 >= 30fps) 的职责, 避免 CI 软件渲染 (SwiftShader) 误报。
 *
 * 运行前提 (与 CI benchmark job 同款环境):
 *   - demo dev server 已运行 (CI: pnpm --filter @3dgs/demo dev &)
 *   - playwright chromium 已安装 (CI: npx playwright install --with-deps chromium)
 *
 * 运行: npx tsx e2e/render-smoke.ts
 */

import { chromium } from 'playwright';

const DEMO_URL = process.env.DEMO_URL ?? 'http://localhost:5173';
const LOAD_TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    // SwiftShader 软件渲染 — CI 无 GPU 也能跑 WebGL
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    // ── 收集控制台错误与未捕获异常 ──
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    // ── 帧采集: 独立 RAF 循环 (只记帧时间, 不触碰 canvas) ──
    await page.addInitScript(`
      window.__frames = [];
      var lastT = performance.now();
      requestAnimationFrame(function loop() {
        var now = performance.now();
        window.__frames.push(now - lastT);
        lastT = now;
        if (window.__frames.length > 1200) window.__frames.shift();
        requestAnimationFrame(loop);
      });
    `);

    // ── 加载 demo ──
    console.log(`[render-smoke] loading ${DEMO_URL} ...`);
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 1. 渲染器挂载: #viewer 下出现 canvas (WebGL 上下文创建成功)
    await page.waitForSelector('#viewer canvas', { timeout: LOAD_TIMEOUT_MS });
    console.log('[render-smoke] canvas mounted');

    // 2. 场景加载完成: loading 指示器隐藏
    await page.waitForSelector('#loading', { state: 'hidden', timeout: LOAD_TIMEOUT_MS });
    console.log('[render-smoke] scene load flow completed');

    // 3a. 渲染循环持续输出帧
    await page.waitForFunction(
      () => (window as unknown as { __frames: number[] }).__frames.length >= 10,
      { timeout: LOAD_TIMEOUT_MS },
    );

    // 3b. 首帧像素非空: 加载完成后 evaluate 内多帧采样
    // ★ 字符串形式 (同 benchmark.ts): tsx/esbuild 会给 TS 回调注入 __name 辅助,
    //   在浏览器上下文未定义, 必须用字符串避免 RAF 循环中断
    const pixelRatios = (await page.evaluate(`(async () => {
      const canvas = document.querySelector('#viewer canvas');
      if (!canvas) return [];
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return [];
      const { promise, resolve } = Promise.withResolvers();
      const ratios = [];
      let n = 0;
      const sample = () => {
        const buf = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let nonZero = 0;
        let total = 0;
        for (let i = 0; i < buf.length; i += 4) {
          total++;
          if (buf[i] !== 0 || buf[i + 1] !== 0 || buf[i + 2] !== 0) nonZero++;
        }
        ratios.push(nonZero / total);
        n++;
        if (n < 6) requestAnimationFrame(sample);
        else resolve(ratios);
      };
      requestAnimationFrame(sample);
      return promise;
    })()`) as number[]);

    const frameCount = (await page.evaluate(
      `(window.__frames || []).length`,
    )) as number;
    const renderedRatio = Math.max(...pixelRatios, 0);
    console.log(
      `[render-smoke] frames=${frameCount} renderedPixelRatio=${renderedRatio.toFixed(4)}`,
    );

    if (frameCount < 10) {
      throw new Error(`E2E failed: 渲染循环未持续输出帧 (frames=${frameCount})`);
    }
    if (pixelRatios.length === 0) {
      throw new Error('E2E failed: 无法在已加载页面采样 WebGL 首帧像素');
    }
    if (renderedRatio < 0.01) {
      throw new Error(
        `E2E failed: 所有采样帧 canvas 像素均全空 (maxRatio=${renderedRatio.toFixed(4)})`,
      );
    }

    // 4. 无控制台错误
    if (consoleErrors.length > 0) {
      throw new Error(
        `E2E failed: 主路径出现 ${consoleErrors.length} 个控制台错误:\n${consoleErrors.join('\n')}`,
      );
    }

    console.log('[render-smoke] PASS — canvas 首帧渲染且无控制台错误');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});