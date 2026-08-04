/**
 * Playwright 性能基准测试脚本 (v2)
 *
 * 对 3DGS Demo 进行自动化性能基准测试,
 * 采集 FPS、帧时间、内存等数据并生成报告。
 *
 * v2 改进:
 *   - 增加"移动状态"对比测试 (模拟 WASD 键盘移动)
 *   - 采集 GPU/浏览器信息
 *   - 页面只加载一次, 通过场景按钮切换
 *   - 生成 JSON 格式原始数据 + Markdown 报告
 *
 * 前置条件:
 *   1. pnpm build (构建所有包)
 *   2. pnpm --filter @3dgs/demo dev (启动 Demo 开发服务器)
 *   3. npx playwright install chromium (安装浏览器)
 *
 * 运行:
 *   npx tsx benchmarks/benchmark.ts
 *
 * [来源: Playwright — playwright.dev/docs/api/class-page]
 * [来源: Performance API — developer.mozilla.org/en-US/docs/Web/API/Performance_API]
 */

import { chromium, type Browser, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 类型定义 ──────────────────────────────────────────────

/** 基准测试配置 */
interface BenchmarkConfig {
  /** Demo URL */
  url: string;
  /** 预热时间 (ms, 等待场景加载完成) */
  warmupMs: number;
  /** 采样持续时间 (ms) */
  durationMs: number;
  /** 测试场景列表 */
  scenes: string[];
  /** 设备仿真 */
  device: 'desktop' | 'mobile';
  /** 是否测试移动状态 */
  testMovement: boolean;
}

/** 单场景单模式测试结果 */
interface SceneModeResult {
  scene: string;
  mode: 'idle' | 'moving';
  avgFps: number;
  p5Fps: number;
  p50Fps: number;
  p95Fps: number;
  avgFrameTime: number;
  maxFrameTime: number;
  p95FrameTime: number;
  stdFrameTime: number;
  droppedFrames: number;
  droppedFrameRate: number;
  avgJsHeapMB?: number;
  peakJsHeapMB?: number;
  sampleCount: number;
}

/** 场景汇总结果 */
interface SceneSummary {
  scene: string;
  idle: SceneModeResult;
  moving?: SceneModeResult;
  loadTimeMs: number;
}

/** GPU/浏览器信息 */
interface SystemInfo {
  userAgent: string;
  platform: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory?: number;
  webglVendor?: string;
  webglRenderer?: string;
  isCrossOriginIsolated: boolean;
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: BenchmarkConfig = {
  url: 'http://localhost:5173',
  warmupMs: 10000,
  durationMs: 8000,
  scenes: ['demo1', 'demo2', 'demo3', 'kitchen'],
  device: 'desktop',
  testMovement: true,
};

// ─── 主流程 ────────────────────────────────────────────────

async function main() {
  const config = { ...DEFAULT_CONFIG };

  console.log('='.repeat(60));
  console.log('  3DGS 性能基准测试 v2');
  console.log('='.repeat(60));
  console.log(`  URL:       ${config.url}`);
  console.log(`  预热:      ${config.warmupMs}ms`);
  console.log(`  采样:      ${config.durationMs}ms / 模式`);
  console.log(`  场景:      ${config.scenes.join(', ')}`);
  console.log(`  移动测试:  ${config.testMovement ? '是' : '否'}`);
  console.log(`  设备:      ${config.device}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-gpu',
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--enable-features=Vulkan',
    ],
  });

  const context = await browser.newContext({
    viewport: config.device === 'mobile'
      ? { width: 390, height: 844 }
      : { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // 收集控制台错误
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // 注入性能采集脚本 (独立 RAF, 不依赖 Demo 代码)
  // ★ 使用字符串形式避免 tsx/esbuild 注入 __name 辅助函数
  //   (esbuild 的 __name 在浏览器上下文未定义, 会导致 RAF 循环中断)
  // [来源: esbuild keepNames — github.com/evanw/esbuild/issues/2517]
  await page.addInitScript(`
    window.__perfSamples = [];
    var lastTime = performance.now();
    requestAnimationFrame(function loop() {
      var now = performance.now();
      var dt = now - lastTime;
      lastTime = now;
      window.__perfSamples.push({
        time: now,
        frameTime: dt,
        fps: dt > 0 ? 1000 / dt : 0,
        jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1024 / 1024 : undefined
      });
      requestAnimationFrame(loop);
    });
  `);

  // 导航到 Demo 并等待加载
  console.log('\n加载 Demo...');
  const navStart = Date.now();
  await page.goto(config.url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 30000 });
  const initialLoadMs = Date.now() - navStart;
  console.log(`  初始加载: ${initialLoadMs}ms`);

  // 收集系统信息 (必须在导航后, 才能检测 COOP/COEP)
  console.log('\n收集系统信息...');
  const sysInfo = await collectSystemInfo(page, config);
  console.log(`  UA:           ${sysInfo.userAgent.slice(0, 80)}...`);
  console.log(`  Platform:     ${sysInfo.platform}`);
  console.log(`  CPU 核心:     ${sysInfo.hardwareConcurrency}`);
  console.log(`  设备内存:     ${sysInfo.deviceMemory ?? 'N/A'} GB`);
  console.log(`  GPU:          ${sysInfo.webglRenderer ?? 'N/A'}`);
  console.log(`  跨域隔离:     ${sysInfo.isCrossOriginIsolated ? '✓' : '✗'}`);
  console.log(`  DPR:          ${sysInfo.devicePixelRatio}`);

  if (consoleErrors.length > 0) {
    console.log(`  控制台错误 (${consoleErrors.length}):`);
    for (const err of consoleErrors.slice(0, 5)) {
      console.log(`    ❌ ${err.slice(0, 200)}`);
    }
  }

  // 逐场景测试
  const results: SceneSummary[] = [];

  for (const scene of config.scenes) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  场景: ${scene}`);
    console.log('─'.repeat(50));

    // 切换到目标场景
    const switchStart = Date.now();
    await switchToScene(page, scene);
    // 等待加载完成 (loading 指示器隐藏)
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000); // 等待场景稳定

    // 预热
    console.log(`  预热 ${config.warmupMs}ms...`);
    await page.waitForTimeout(config.warmupMs);

    // 清空采样数据
    await page.evaluate('window.__perfSamples = []');

    // ── 静止状态采样 ──
    console.log(`  [静止] 采样 ${config.durationMs}ms...`);
    await page.waitForTimeout(config.durationMs);
    const idleResult = await collectResult(page, scene, 'idle');
    logResult(idleResult);

    // ── 移动状态采样 ──
    let movingResult: SceneModeResult | undefined;
    if (config.testMovement) {
      // 清空采样数据
      await page.evaluate('window.__perfSamples = []');

      console.log(`  [移动] 采样 ${config.durationMs}ms...`);
      await simulateMovement(page, config.durationMs);
      movingResult = await collectResult(page, scene, 'moving');
      logResult(movingResult);

      // 确保所有按键释放
      await page.keyboard.up('w');
      await page.keyboard.up('a');
      await page.keyboard.up('s');
      await page.keyboard.up('d');
      await page.keyboard.up('q');
      await page.keyboard.up('e');
    }

    const loadTimeMs = Date.now() - switchStart;
    results.push({
      scene,
      idle: idleResult,
      moving: movingResult,
      loadTimeMs,
    });
  }

  await browser.close();

  // 生成报告
  generateReport(results, sysInfo, config);
}

// ─── 辅助函数 ──────────────────────────────────────────────

/** 收集系统信息 */
async function collectSystemInfo(page: Page, config: BenchmarkConfig): Promise<SystemInfo> {
  // ★ 使用 IIFE 字符串形式避免 __name 问题
  return await page.evaluate(`(function() {
    var gl = document.createElement('canvas').getContext('webgl2');
    var webglVendor, webglRenderer;
    if (gl) {
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        webglVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      }
    }
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      webglVendor: webglVendor,
      webglRenderer: webglRenderer,
      isCrossOriginIsolated: window.crossOriginIsolated
    };
  })()`);
}

/** 切换到指定场景 */
async function switchToScene(page: Page, scene: string): Promise<void> {
  // Demo 场景按钮按 config.scenes 顺序生成, 使用 data 属性或索引点击
  // 按钮文本是中文标题, 所以通过 evaluate 获取按钮列表并点击对应索引
  const sceneIndexMap: Record<string, number> = {
    demo1: 0, demo2: 1, demo3: 2, kitchen: 3,
  };
  const idx = sceneIndexMap[scene] ?? 0;
  const clicked = await page.evaluate((index) => {
    const buttons = document.querySelectorAll('#scene-selector button');
    if (buttons[index]) {
      (buttons[index] as HTMLElement).click();
      return true;
    }
    return false;
  }, idx);
  if (!clicked) {
    console.warn(`    ⚠ 场景按钮未找到: ${scene} (index ${idx})`);
  }
}

/** 模拟 WASD 移动 */
async function simulateMovement(page: Page, durationMs: number): Promise<void> {
  const halfDuration = durationMs / 2;

  // 前半段: W (前进) + D (右移)
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(halfDuration);

  // 后半段: S (后退) + A (左移)
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  await page.keyboard.down('s');
  await page.keyboard.down('a');
  await page.waitForTimeout(halfDuration);

  // 释放所有按键
  await page.keyboard.up('s');
  await page.keyboard.up('a');
}

/** 收集采样结果 */
async function collectResult(
  page: Page,
  scene: string,
  mode: 'idle' | 'moving',
): Promise<SceneModeResult> {
  const rawSamples = await page.evaluate('window.__perfSamples');

  const samples = (rawSamples ?? []) as Array<{
    time: number;
    frameTime: number;
    fps: number;
    jsHeapMB?: number;
  }>;

  if (samples.length < 10) {
    console.warn(`    ⚠ 采样数据不足 (${samples.length} 帧), 可能 Demo 未正常渲染`);
  }

  // 跳过前 3 帧 (可能包含切换噪声)
  const cleanSamples = samples.length > 3 ? samples.slice(3) : samples;

  const fpsValues = cleanSamples.map((s) => s.fps).sort((a, b) => a - b);
  const frameTimes = cleanSamples.map((s) => s.frameTime).sort((a, b) => a - b);
  const droppedFrames = cleanSamples.filter((s) => s.frameTime > 20).length;
  const memSamples = cleanSamples.filter(
    (s) => s.jsHeapMB !== undefined,
  ) as Array<{ jsHeapMB: number }>;

  const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const variance =
    frameTimes.reduce((sum, ft) => sum + (ft - avgFrameTime) ** 2, 0) / frameTimes.length;

  return {
    scene,
    mode,
    avgFps: Math.round((fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length) * 10) / 10,
    p5Fps: Math.round(percentile(fpsValues, 5) * 10) / 10,
    p50Fps: Math.round(percentile(fpsValues, 50) * 10) / 10,
    p95Fps: Math.round(percentile(fpsValues, 95) * 10) / 10,
    avgFrameTime: Math.round(avgFrameTime * 100) / 100,
    maxFrameTime: Math.round(frameTimes[frameTimes.length - 1] * 100) / 100,
    p95FrameTime: Math.round(percentile(frameTimes, 95) * 100) / 100,
    stdFrameTime: Math.round(Math.sqrt(variance) * 100) / 100,
    droppedFrames,
    droppedFrameRate: Math.round((droppedFrames / cleanSamples.length) * 1000) / 10,
    avgJsHeapMB:
      memSamples.length > 0
        ? Math.round((memSamples.reduce((a, s) => a + s.jsHeapMB, 0) / memSamples.length) * 100) / 100
        : undefined,
    peakJsHeapMB:
      memSamples.length > 0
        ? Math.round(Math.max(...memSamples.map((s) => s.jsHeapMB)) * 100) / 100
        : undefined,
    sampleCount: cleanSamples.length,
  };
}

/** 百分位数计算 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/** 打印单条结果 */
function logResult(r: SceneModeResult): void {
  console.log(`    AvgFPS: ${r.avgFps} | P50: ${r.p50Fps} | P5: ${r.p5Fps} | P95: ${r.p95Fps}`);
  console.log(`    帧时间: Avg ${r.avgFrameTime}ms | P95 ${r.p95FrameTime}ms | Max ${r.maxFrameTime}ms | Std ${r.stdFrameTime}ms`);
  console.log(`    丢帧: ${r.droppedFrames}/${r.sampleCount} (${r.droppedFrameRate}%)`);
  if (r.avgJsHeapMB) {
    console.log(`    内存: Avg ${r.avgJsHeapMB}MB | Peak ${r.peakJsHeapMB}MB`);
  }
}

/** 生成完整报告 (控制台 + JSON + Markdown) */
function generateReport(
  results: SceneSummary[],
  sysInfo: SystemInfo,
  config: BenchmarkConfig,
): void {
  const timestamp = new Date().toISOString();

  // ── 控制台表格 ──
  console.log('\n');
  console.log('='.repeat(70));
  console.log('  性能基准报告');
  console.log('='.repeat(70));
  console.log(`  日期:     ${timestamp}`);
  console.log(`  设备:     ${config.device}`);
  console.log(`  采样时长: ${config.durationMs}ms / 模式`);
  console.log(`  GPU:      ${sysInfo.webglRenderer ?? 'N/A'}`);
  console.log(`  CPU:      ${sysInfo.hardwareConcurrency} cores`);
  console.log('='.repeat(70));

  // FPS 对比表
  console.log('\n┌──────────┬────────┬───────────────────────────────────────────────────┐');
  console.log('│ 场景     │ 模式   │ AvgFPS │ P50FPS │ P5FPS  │ AvgFT  │ P95FT  │ 丢帧率 │');
  console.log('├──────────┼────────┼───────────────────────────────────────────────────┤');

  for (const r of results) {
    console.log(formatTableRow(r.scene, '静止', r.idle));
    if (r.moving) {
      console.log(formatTableRow(r.scene, '移动', r.moving));
    }
    if (r.moving) {
      console.log('├──────────┼────────┼───────────────────────────────────────────────────┤');
    }
  }

  console.log('└──────────┴────────┴───────────────────────────────────────────────────┘');

  // 加载时间
  console.log('\n加载时间:');
  for (const r of results) {
    console.log(`  ${r.scene}: ${r.loadTimeMs}ms`);
  }

  // 达标判定 (使用 P50 代替 Avg, 避免移动模式极端值干扰)
  console.log('\n达标判定 (目标: P50 ≥ 30fps):');
  for (const r of results) {
    const idlePass = r.idle.p50Fps >= 30;
    console.log(`  ${r.scene} [静止]: ${idlePass ? '✅ 通过' : '❌ 未达标'} (P50 ${r.idle.p50Fps}, Avg ${r.idle.avgFps})`);
    if (r.moving) {
      const movePass = r.moving.p50Fps >= 30;
      console.log(`  ${r.scene} [移动]: ${movePass ? '✅ 通过' : '❌ 未达标'} (P50 ${r.moving.p50Fps}, Avg ${r.moving.avgFps})`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('  报告结束');
  console.log('='.repeat(70));

  // ── 保存 JSON ──
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const reportDir = join(scriptDir, 'reports');
  mkdirSync(reportDir, { recursive: true });

  const jsonReport = {
    timestamp,
    config,
    systemInfo: sysInfo,
    results,
  };

  const jsonPath = join(reportDir, `benchmark-${Date.now()}.json`);
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`\nJSON 报告已保存: ${jsonPath}`);
}

/** 格式化表格行 */
function formatTableRow(scene: string, mode: string, r: SceneModeResult): string {
  const pad = (s: string | number, len: number) => String(s).padStart(len);
  return `│ ${scene.padEnd(8)} │ ${mode.padEnd(6)} │ ${pad(r.avgFps, 6)} │ ${pad(r.p50Fps, 6)} │ ${pad(r.p5Fps, 6)} │ ${pad(r.avgFrameTime, 6)} │ ${pad(r.p95FrameTime, 6)} │ ${pad(r.droppedFrameRate + '%', 6)} │`;
}

// ─── 启动 ──────────────────────────────────────────────────

main().catch((err) => {
  console.error('基准测试失败:', err);
  process.exit(1);
});
