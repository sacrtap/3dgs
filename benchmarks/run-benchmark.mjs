/**
 * 3DGS 性能基准自动化测试脚本
 *
 * 使用 Playwright 自动化浏览器，遍历 5 场景 × 4 格式共 18 组测试，
 * 采集 FPS、加载时间、帧时间等指标，生成 Markdown 报告。
 *
 * 用法: node benchmarks/run-benchmark.mjs
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_URL = 'http://localhost:4173/';
const REPORT_PATH = join(__dirname, 'reports', 'benchmark-report.md');
const JSON_PATH = join(__dirname, 'reports', 'benchmark-results.json');
const TIMEOUT_PER_SCENE = 180000; // 3 minutes per scene
const STABILIZE_WAIT = 3000; // 3s stabilization after format switch
const BENCH_DURATION = 10000; // 10s benchmark collection

// Scenes and formats to test
const SCENES = ['kitchen', 'demo1', 'storysplat', 'demo2', 'garden'];
const FORMATS = ['ply', 'splat', 'spz', 'sog'];

function formatNum(n, decimals = 1) {
  return (typeof n === 'number' && isFinite(n)) ? n.toFixed(decimals) : '—';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function main() {
  console.log('🚀 3DGS 性能基准自动化测试\n');
  console.log(`   URL: ${DEMO_URL}`);
  console.log(`   场景: ${SCENES.length} 个`);
  console.log(`   格式: ${FORMATS.length} 种 (${FORMATS.join(', ')})`);
  console.log(`   预计组合: ${SCENES.length * FORMATS.length} 组 (含 N/A)\n`);

  // Launch browser with GPU support
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--enable-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--enable-features=Vulkan,UseSkiaRenderer',
      '--disable-features=UseChromeOSDirectVideoDecoder',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Collect console messages for debugging
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') {
      console.error('  [Browser Error]', msg.text());
    }
  });

  console.log('📡 导航到 Demo 页面...');
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for the benchmark system to be ready
  console.log('⏳ 等待渲染器初始化和首帧加载...');
  try {
    await page.waitForFunction(() => window.__benchReady === true, { timeout: 60000 });
    console.log('  ✅ 渲染器已就绪\n');
  } catch (err) {
    console.error('  ❌ 渲染器初始化超时');
    console.error('  Console logs:');
    consoleLogs.slice(-20).forEach(log => console.error('  ', log));
    await browser.close();
    process.exit(1);
  }

  // Get device info
  const deviceInfo = await page.evaluate(() => window.__getDeviceInfo());
  console.log('📊 设备信息:');
  console.log(`   Backend: ${deviceInfo.backend}`);
  console.log(`   Device Tier: ${deviceInfo.deviceTier}`);
  console.log(`   GPU: ${deviceInfo.gpu}`);
  console.log(`   SAB: ${deviceInfo.sab ? '✓' : '✗'}`);
  console.log(`   Resolution Scale: ${(deviceInfo.resolutionScale * 100).toFixed(0)}%`);
  console.log(`   UA: ${deviceInfo.userAgent}\n`);

  // Get file sizes
  const sceneData = await page.evaluate(() => {
    const data = window.__sceneData;
    const result = {};
    for (const [id, scene] of Object.entries(data)) {
      result[id] = {
        title: scene.title,
        splatCount: scene.splatCount,
        formats: {},
      };
      for (const [fmt, fmtData] of Object.entries(scene.formats)) {
        result[id].formats[fmt] = {
          url: fmtData.url,
          size: fmtData.size,
          desc: fmtData.desc,
        };
      }
    }
    return result;
  });

  console.log('📁 场景数据配置:');
  for (const [id, scene] of Object.entries(sceneData)) {
    console.log(`   ${scene.title} (${scene.splatCount}):`);
    for (const [fmt, fmtData] of Object.entries(scene.formats)) {
      const status = fmtData.url ? `${fmtData.size}` : 'N/A';
      console.log(`     ${fmt.toUpperCase().padEnd(6)} ${status}`);
    }
  }
  console.log('');

  // Run automated benchmark
  const allResults = [];
  let totalTests = SCENES.length * FORMATS.length;
  let currentTest = 0;

  for (const sceneId of SCENES) {
    const scene = sceneData[sceneId];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎬 场景: ${scene.title} (${scene.splatCount})`);
    console.log(`${'='.repeat(60)}`);

    // Switch to scene
    console.log(`  ⏳ 切换到场景 ${scene.title}...`);
    try {
      await page.evaluate(async (sid) => {
        await window.__switchScene(sid);
      }, sceneId);
      console.log(`  ✅ 场景已加载`);
    } catch (err) {
      console.error(`  ❌ 场景切换失败: ${err.message}`);
      // Record error for all formats
      for (const format of FORMATS) {
        currentTest++;
        allResults.push({
          scene: scene.title,
          format: format.toUpperCase(),
          splatCount: scene.splatCount,
          error: `Scene switch failed: ${err.message}`,
        });
      }
      continue;
    }

    // Test each format
    for (const format of FORMATS) {
      currentTest++;
      const fmtData = scene.formats[format];
      const progress = `[${currentTest}/${totalTests}]`;

      if (!fmtData.url) {
        console.log(`  ${progress} ⏭️  ${format.toUpperCase().padEnd(6)} — N/A (无源文件)`);
        allResults.push({
          scene: scene.title,
          format: format.toUpperCase(),
          splatCount: scene.splatCount,
          error: 'N/A (无源文件)',
        });
        continue;
      }

      console.log(`  ${progress} 🔄 ${format.toUpperCase().padEnd(6)} 加载中 (${fmtData.size})...`);

      try {
        // Switch format
        const switched = await page.evaluate(async (fmt) => {
          return await window.__switchFormat(fmt);
        }, format);

        if (!switched) {
          console.log(`  ${progress} ⏭️  ${format.toUpperCase().padEnd(6)} — 不可用`);
          allResults.push({
            scene: scene.title,
            format: format.toUpperCase(),
            splatCount: scene.splatCount,
            error: 'Format not available',
          });
          continue;
        }

        console.log(`  ${progress} ✅ ${format.toUpperCase().padEnd(6)} 已加载, 开始采集 (10s)...`);

        // Run benchmark
        const result = await page.evaluate(async (duration) => {
          return await window.__runBench(duration);
        }, BENCH_DURATION);

        if (result) {
          console.log(`  ${progress} 📊 ${format.toUpperCase().padEnd(6)} FPS P50: ${formatNum(result.fpsP50)}, P5: ${formatNum(result.fpsP5)}, Avg: ${formatNum(result.fpsAvg)}, Load: ${formatNum(result.loadTime, 0)}ms`);
          allResults.push(result);
        } else {
          console.log(`  ${progress} ⚠️  ${format.toUpperCase().padEnd(6)} 采集失败 (无数据)`);
          allResults.push({
            scene: scene.title,
            format: format.toUpperCase(),
            splatCount: scene.splatCount,
            error: 'No benchmark data collected',
          });
        }
      } catch (err) {
        console.error(`  ${progress} ❌ ${format.toUpperCase().padEnd(6)} 错误: ${err.message}`);
        allResults.push({
          scene: scene.title,
          format: format.toUpperCase(),
          splatCount: scene.splatCount,
          error: err.message,
        });
      }
    }
  }

  // Generate report
  console.log('\n\n' + '='.repeat(60));
  console.log('📝 生成测试报告...');
  console.log('='.repeat(60) + '\n');

  const report = generateReport(deviceInfo, sceneData, allResults, consoleLogs);
  writeFileSync(REPORT_PATH, report, 'utf-8');
  console.log(`  ✅ Markdown 报告: ${REPORT_PATH}`);

  // Also save raw JSON results
  const jsonResult = {
    timestamp: new Date().toISOString(),
    deviceInfo,
    sceneData,
    results: allResults,
  };
  writeFileSync(JSON_PATH, JSON.stringify(jsonResult, null, 2), 'utf-8');
  console.log(`  ✅ JSON 结果: ${JSON_PATH}`);

  // Print summary table
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(60));
  console.log('');

  // Group by scene
  const scenes = [...new Set(allResults.map(r => r.scene))];
  for (const sceneName of scenes) {
    const sceneResults = allResults.filter(r => r.scene === sceneName);
    const splatCount = sceneResults[0]?.splatCount || '—';
    console.log(`  ${sceneName} (${splatCount} splats):`);
    for (const r of sceneResults) {
      if (r.error) {
        console.log(`    ${r.format.padEnd(6)} — ${r.error}`);
      } else {
        console.log(`    ${r.format.padEnd(6)} FPS: P50=${formatNum(r.fpsP50).padStart(6)}, P5=${formatNum(r.fpsP5).padStart(6)}, Avg=${formatNum(r.fpsAvg).padStart(6)} | Load: ${formatNum(r.loadTime, 0).padStart(7)}ms | FT P95: ${formatNum(r.ftP95).padStart(6)}ms | Drop: ${formatNum(r.dropRate)}%`);
      }
    }
    console.log('');
  }

  await browser.close();
  console.log('✅ 测试完成!\n');
}

function generateReport(deviceInfo, sceneData, results, consoleLogs) {
  const now = new Date();
  const timestamp = now.toISOString();
  const dateStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let md = `# 3DGS 性能基准测试报告

**测试时间**: ${dateStr}
**测试工具**: Playwright 自动化采集 (10s/组)

## 测试环境

| 项目 | 值 |
|------|------|
| Backend | ${deviceInfo.backend} |
| 设备分级 | ${deviceInfo.deviceTier} |
| GPU | ${deviceInfo.gpu} |
| SharedArrayBuffer | ${deviceInfo.sab ? '✓ 已启用' : '✗ 未启用'} |
| 分辨率缩放 | ${(deviceInfo.resolutionScale * 100).toFixed(0)}% |
| User Agent | \`${deviceInfo.userAgent}\` |

## 测试场景

| 场景 | Splat 数量 | 可用格式 |
|------|-----------|---------|
`;

  for (const [id, scene] of Object.entries(sceneData)) {
    const availableFormats = Object.entries(scene.formats)
      .filter(([_, v]) => v.url)
      .map(([k, _]) => k.toUpperCase())
      .join(', ');
    const allFormats = Object.entries(scene.formats)
      .map(([k, v]) => v.url ? k.toUpperCase() : `~~${k.toUpperCase()}~~`)
      .join(', ');
    md += `| ${scene.title} | ${scene.splatCount} | ${allFormats} |\n`;
  }

  // File sizes
  md += `\n## 数据文件信息\n\n`;
  md += `| 场景 | 格式 | 文件大小 | 说明 |\n`;
  md += `|------|------|---------|------|\n`;
  for (const [id, scene] of Object.entries(sceneData)) {
    for (const [fmt, fmtData] of Object.entries(scene.formats)) {
      if (fmtData.url) {
        md += `| ${scene.title} | ${fmt.toUpperCase()} | ${fmtData.size} | ${fmtData.desc} |\n`;
      } else {
        md += `| ${scene.title} | ${fmt.toUpperCase()} | — | 无源文件 |\n`;
      }
    }
  }

  // Main results table
  md += `\n## 性能测试结果\n\n`;
  md += `> ★ L2: P50/P5 为主要指标, Avg 仅作参考 (已过滤 RAF 合并伪影 <3ms)\n\n`;
  md += `| 场景 | 格式 | Splat 数 | 加载时间 (ms) | FPS P50 | FPS P5 | FPS Avg | 帧时间 P95 (ms) | 帧时间 Max (ms) | 丢帧率 (%) | 采样数 |\n`;
  md += `|------|------|---------|-------------|---------|--------|---------|---------------|---------------|----------|-------|\n`;

  for (const r of results) {
    if (r.error) {
      md += `| ${r.scene} | ${r.format} | ${r.splatCount} | — | — | — | — | — | — | — | ❌ ${r.error} |\n`;
    } else {
      md += `| ${r.scene} | ${r.format} | ${r.splatCount} | ${formatNum(r.loadTime, 0)} | ${formatNum(r.fpsP50)} | ${formatNum(r.fpsP5)} | ${formatNum(r.fpsAvg)} | ${formatNum(r.ftP95)} | ${formatNum(r.ftMax)} | ${formatNum(r.dropRate)} | ${r.sampleCount || '—'} |\n`;
    }
  }

  // Analysis sections
  md += `\n## 横向分析 (同场景不同格式对比)\n\n`;

  const scenes = [...new Set(results.map(r => r.scene))];
  for (const sceneName of scenes) {
    const sceneResults = results.filter(r => r.scene === sceneName && !r.error);
    if (sceneResults.length === 0) continue;

    const splatCount = sceneResults[0]?.splatCount || '—';
    md += `### ${sceneName} (${splatCount} splats)\n\n`;

    // Find best format for each metric
    const bestLoadTime = Math.min(...sceneResults.map(r => r.loadTime));
    const bestFpsAvg = Math.max(...sceneResults.map(r => r.fpsAvg));
    const bestFpsP5 = Math.max(...sceneResults.map(r => r.fpsP5));
    const bestFtP95 = Math.min(...sceneResults.map(r => r.ftP95));

    md += `| 格式 | 加载时间 | FPS P50 | FPS P5 | FPS Avg | 帧时间 P95 | 帧时间 Max | 丢帧率 | 评价 |\n`;
    md += `|------|---------|---------|--------|---------|----------|----------|-------|------|\n`;

    for (const r of sceneResults) {
      const loadRank = r.loadTime === bestLoadTime ? '🥇' : '';
      const p50Rank = r.fpsP50 === Math.max(...sceneResults.map(s => s.fpsP50)) ? '🥇' : '';
      const p5Rank = r.fpsP5 === bestFpsP5 ? '🥇' : '';
      const ftRank = r.ftP95 === bestFtP95 ? '🥇' : '';

      let rating = '';
      if (r.fpsP50 >= 55) rating = '⭐⭐⭐ 优秀';
      else if (r.fpsP50 >= 30) rating = '⭐⭐ 良好';
      else if (r.fpsP50 >= 15) rating = '⭐ 可接受';
      else rating = '⚠️ 卡顿';

      md += `| ${r.format} | ${formatNum(r.loadTime, 0)} ${loadRank} | ${formatNum(r.fpsP50)} ${p50Rank} | ${formatNum(r.fpsP5)} ${p5Rank} | ${formatNum(r.fpsAvg)} | ${formatNum(r.ftP95)} ${ftRank} | ${formatNum(r.ftMax)} | ${formatNum(r.dropRate)}% | ${rating} |\n`;
    }
    md += '\n';
  }

  // Vertical analysis
  md += `## 纵向分析 (同格式不同场景对比)\n\n`;

  for (const format of FORMATS) {
    const formatUpper = format.toUpperCase();
    const formatResults = results.filter(r => r.format === formatUpper && !r.error);
    if (formatResults.length === 0) continue;

    md += `### ${formatUpper} 格式\n\n`;
    md += `| 场景 | Splat 数 | 加载时间 | FPS P50 | FPS P5 | FPS Avg | 帧时间 P95 | 丢帧率 |\n`;
    md += `|------|---------|---------|---------|--------|---------|----------|-------|\n`;

    // Sort by splat count (approximate by scene order)
    for (const r of formatResults) {
      md += `| ${r.scene} | ${r.splatCount} | ${formatNum(r.loadTime, 0)}ms | ${formatNum(r.fpsP50)} | ${formatNum(r.fpsP5)} | ${formatNum(r.fpsAvg)} | ${formatNum(r.ftP95)}ms | ${formatNum(r.dropRate)}% |\n`;
    }

    // Trend analysis
    if (formatResults.length >= 2) {
      const first = formatResults[0];
      const last = formatResults[formatResults.length - 1];
      const fpsDrop = first.fpsP50 - last.fpsP50;
      const loadIncrease = last.loadTime - first.loadTime;
      md += `\n**趋势分析**: 从 ${first.scene} (${first.splatCount}) 到 ${last.scene} (${last.splatCount})\n`;
      md += `- FPS P50 变化: ${fpsDrop >= 0 ? '下降' : '上升'} ${formatNum(Math.abs(fpsDrop))} FPS\n`;
      md += `- 加载时间变化: ${loadIncrease >= 0 ? '增加' : '减少'} ${formatNum(Math.abs(loadIncrease), 0)} ms\n`;
    }
    md += '\n';
  }

  // Key findings
  md += `## 关键发现\n\n`;

  const validResults = results.filter(r => !r.error);
  if (validResults.length > 0) {
    // Best overall FPS
    const bestFps = validResults.reduce((best, r) => r.fpsP50 > best.fpsP50 ? r : best);
    md += `- **最高 FPS P50**: ${bestFps.scene} / ${bestFps.format} — ${formatNum(bestFps.fpsP50)} FPS\n`;

    // Fastest load
    const fastestLoad = validResults.reduce((best, r) => r.loadTime < best.loadTime ? r : best);
    md += `- **最快加载**: ${fastestLoad.scene} / ${fastestLoad.format} — ${formatNum(fastestLoad.loadTime, 0)} ms\n`;

    // Lowest frame time P95
    const lowestFt = validResults.reduce((best, r) => r.ftP95 < best.ftP95 ? r : best);
    md += `- **最低帧时间 P95**: ${lowestFt.scene} / ${lowestFt.format} — ${formatNum(lowestFt.ftP95)} ms\n`;

    // Worst performance
    const worstFps = validResults.reduce((worst, r) => r.fpsP50 < worst.fpsP50 ? r : worst);
    md += `- **最低 FPS P50**: ${worstFps.scene} / ${worstFps.format} — ${formatNum(worstFps.fpsP50)} FPS\n`;

    // Format comparison summary
    md += `\n### 格式对比总结\n\n`;
    for (const format of FORMATS) {
      const formatUpper = format.toUpperCase();
      const formatResults = validResults.filter(r => r.format === formatUpper);
      if (formatResults.length === 0) continue;

      const avgFps = formatResults.reduce((a, b) => a + b.fpsP50, 0) / formatResults.length;
      const avgLoad = formatResults.reduce((a, b) => a + b.loadTime, 0) / formatResults.length;
      const avgDrop = formatResults.reduce((a, b) => a + b.dropRate, 0) / formatResults.length;

      md += `**${formatUpper}** (平均 ${formatResults.length} 场景):\n`;
      md += `- 平均 FPS P50: ${formatNum(avgFps)}\n`;
      md += `- 平均加载时间: ${formatNum(avgLoad, 0)} ms\n`;
      md += `- 平均丢帧率: ${formatNum(avgDrop)}%\n\n`;
    }

    // Splat count impact
    md += `### Splat 数量对性能的影响\n\n`;
    const splatScenes = ['kitchen', 'demo1', 'storysplat', 'demo2', 'garden'];
    const splatCounts = ['248K', '991K', '1.3M', '3.97M', '5.83M'];
    md += `| Splat 数量 | 场景 | SPLAT FPS P50 | SPZ FPS P50 | SOG FPS P50 | PLY FPS P50 |\n`;
    md += `|-----------|------|---------------|-------------|-------------|------------|\n`;
    for (let i = 0; i < splatScenes.length; i++) {
      const sceneName = sceneData[splatScenes[i]]?.title || splatScenes[i];
      const splatCount = splatCounts[i];
      const fpsByFormat = {};
      for (const fmt of FORMATS) {
        const fmtUpper = fmt.toUpperCase();
        const r = validResults.find(r => r.scene === sceneName && r.format === fmtUpper);
        fpsByFormat[fmt] = r ? formatNum(r.fpsP50) : '—';
      }
      md += `| ${splatCount} | ${sceneName} | ${fpsByFormat.splat} | ${fpsByFormat.spz} | ${fpsByFormat.sog} | ${fpsByFormat.ply} |\n`;
    }
  }

  // Errors
  const errorResults = results.filter(r => r.error);
  if (errorResults.length > 0) {
    md += `\n## 错误记录\n\n`;
    md += `| 场景 | 格式 | 错误信息 |\n`;
    md += `|------|------|---------|\n`;
    for (const r of errorResults) {
      md += `| ${r.scene} | ${r.format} | ${r.error} |\n`;
    }
  }

  // Console logs (last 50)
  if (consoleLogs.length > 0) {
    md += `\n## 浏览器控制台日志 (最后 50 条)\n\n`;
    md += '```\n';
    const lastLogs = consoleLogs.slice(-50);
    for (const log of lastLogs) {
      md += log + '\n';
    }
    md += '```\n';
  }

  md += `\n---\n*报告由 Playwright 自动化测试脚本生成于 ${dateStr}*\n`;

  return md;
}

main().catch(err => {
  console.error('❌ 测试脚本错误:', err);
  process.exit(1);
});
