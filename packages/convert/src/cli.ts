#!/usr/bin/env node
/**
 * @3dgs/convert CLI — 3DGS 数据转换命令行工具
 *
 * 命令:
 *   ply-to-splat <input.ply>   转换 PLY 为 .splat 格式
 *   ply-to-spz <input.ply>     转换 PLY 为 .spz 格式 (gzip 压缩)
 *   ply-to-sog <input.ply>     转换 PLY 为 .sog 格式 (流式 LOD)
 *   batch <dir>                批量转换目录下所有 .ply 文件
 *   generate-tour <dir>        生成 tour.json 配置模板
 *
 * [来源: commander.js — github.com/tj/commander.js]
 */

import { Command } from 'commander';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';

import {
  loadGaussiansFromPly,
  writeSplat,
  writeSpz,
  writeSog,
  pruneGaussians,
  mortonSortGaussians,
  parseSogMetadata,
} from './index.js';

const program = new Command();

program
  .name('3dgs-convert')
  .description('3DGS 数据转换 CLI — PLY → SPLAT / SPZ / SOG')
  .version('0.1.0');

// ── ply-to-splat ──
program
  .command('ply-to-splat')
  .description('转换 PLY 为 .splat 格式 (32 字节/splat)')
  .argument('<input>', 'PLY 文件路径')
  .option('-o, --output <path>', '输出文件路径')
  .option('--prune', '启用冗余剔除 (过滤低透明度/异常高斯核)')
  .option('--min-opacity <num>', '最小不透明度阈值 (默认 0.01)', '0.01')
  .option('--sort', '启用 Morton Code 空间排序')
  .action(async (input: string, opts: Record<string, string>) => {
    await convertPly(input, opts, 'splat');
  });

// ── ply-to-spz ──
program
  .command('ply-to-spz')
  .description('转换 PLY 为 .spz 格式 (gzip 压缩, ~10x 压缩比)')
  .argument('<input>', 'PLY 文件路径')
  .option('-o, --output <path>', '输出文件路径')
  .option('--sh-degree <num>', 'SH 阶数 (0-3, 默认自动检测)', '-1')
  .option('--fractional-bits <num>', '位置量化小数位 (默认 12)', '12')
  .option('--prune', '启用冗余剔除')
  .option('--min-opacity <num>', '最小不透明度阈值', '0.01')
  .option('--sort', '启用 Morton Code 空间排序')
  .action(async (input: string, opts: Record<string, string>) => {
    await convertPly(input, opts, 'spz');
  });

// ── ply-to-sog ──
program
  .command('ply-to-sog')
  .description('转换 PLY 为 .sog 格式 (流式 LOD, 默认空间排序分块)')
  .argument('<input>', 'PLY 文件路径')
  .option('-o, --output <path>', '输出文件路径')
  .option('--chunk-size <num>', '每 chunk 的 splat 数 (默认 16384)', '16384')
  .option('--prune', '启用冗余剔除')
  .option('--min-opacity <num>', '最小不透明度阈值', '0.01')
  .option('--no-sort', '禁用 Morton Code 空间排序 (SOG 默认启用)')
  .action(async (input: string, opts: Record<string, string>) => {
    await convertPly(input, opts, 'sog');
  });

// ── batch ──
program
  .command('batch')
  .description('批量转换目录下所有 .ply 文件')
  .argument('<dir>', '输入目录')
  .option('-f, --format <format>', '输出格式 (splat/spz/sog)', 'spz')
  .option('-o, --output <dir>', '输出目录 (默认 <dir>/output)')
  .option('--sh-degree <num>', 'SH 阶数 (0-3, 默认自动检测)', '-1')
  .option('--prune', '启用冗余剔除')
  .option('--sort', '启用 Morton Code 空间排序')
  .action(async (dir: string, opts: Record<string, string>) => {
    await batchConvert(dir, opts);
  });

// ── generate-tour ──
program
  .command('generate-tour')
  .description('生成 tour.json 配置模板')
  .argument('<dir>', '场景文件目录')
  .option('-o, --output <path>', '输出文件路径 (默认 tour.json)')
  .option('--base-url <url>', '场景文件的基础 URL (默认 ./)')
  .action(async (dir: string, opts: Record<string, string>) => {
    await generateTour(dir, opts);
  });

// ── info ──
program
  .command('info')
  .description('查看 3DGS 文件信息')
  .argument('<input>', '文件路径 (.ply / .splat / .spz / .sog)')
  .action(async (input: string) => {
    await showInfo(input);
  });

/**
 * 转换 PLY 文件
 */
async function convertPly(
  input: string,
  opts: Record<string, string | boolean>,
  format: 'splat' | 'spz' | 'sog',
): Promise<void> {
  const startTime = Date.now();
  console.log(`\n📋 读取 PLY: ${input}`);

  const plyBuffer = await readFile(input);
  const plySize = plyBuffer.byteLength;
  console.log(`   文件大小: ${(plySize / 1024 / 1024).toFixed(2)} MB`);

  // 解析 PLY
  console.log('🔍 解析 PLY...');
  let cloud = loadGaussiansFromPly(plyBuffer.buffer, { source: input });
  console.log(`   高斯核数: ${cloud.vertexCount.toLocaleString()}`);
  console.log(`   SH 阶数: ${cloud.shDegree}`);

  // 冗余剔除
  if (opts.prune) {
    const minOpacity = parseFloat(String(opts.minOpacity || '0.01'));
    const before = cloud.splats.length;
    cloud = pruneGaussians(cloud, { minOpacity });
    const removed = before - cloud.splats.length;
    console.log(`🗑️  冗余剔除: 移除 ${removed.toLocaleString()} 个 (${(removed / before * 100).toFixed(1)}%)`);
  }

  // Morton 排序
  // 对于 SOG 格式, 默认启用排序 (--no-sort 可禁用)
  // 对于 splat/spz 格式, 仅在 --sort 时启用
  const shouldSort = format === 'sog' ? opts.sort !== false : !!opts.sort;
  if (shouldSort) {
    console.log('🔄 Morton Code 空间排序...');
    cloud = mortonSortGaussians(cloud);
  }

  // 确定输出路径
  const outputPath = String(opts.output || defaultOutputPath(input, format));

  // 写入目标格式
  console.log(`📦 转换为 ${format.toUpperCase()}...`);

  let outputData: ArrayBuffer | Uint8Array;

  switch (format) {
    case 'splat': {
      outputData = writeSplat(cloud);
      break;
    }
    case 'spz': {
      const shDegree = parseInt(String(opts.shDegree || '-1'), 10);
      const fractionalBits = parseInt(String(opts.fractionalBits || '12'), 10);
      outputData = await writeSpz(cloud, {
        shDegree: shDegree >= 0 ? shDegree : undefined,
        fractionalBits,
      });
      break;
    }
    case 'sog': {
      const chunkSize = parseInt(String(opts.chunkSize || '16384'), 10);
      // SOG 已在上方完成 Morton 排序, 此处无需重复
      outputData = writeSog(cloud, { chunkSize, spatialSort: false });
      break;
    }
  }

  // 写入文件
  await mkdir(dirname(outputPath), { recursive: true });
  const dataToWrite = outputData instanceof Uint8Array
    ? Buffer.from(outputData)
    : Buffer.from(outputData);
  await writeFile(outputPath, dataToWrite);

  const outputSize = dataToWrite.byteLength;
  const compressionRatio = plySize / outputSize;
  const elapsed = Date.now() - startTime;

  console.log(`\n✅ 转换完成!`);
  console.log(`   输出: ${outputPath}`);
  console.log(`   大小: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   压缩比: ${compressionRatio.toFixed(2)}×`);
  console.log(`   耗时: ${elapsed}ms\n`);
}

/**
 * 批量转换
 */
async function batchConvert(
  dir: string,
  opts: Record<string, string | boolean>,
): Promise<void> {
  const format = String(opts.format) as 'splat' | 'spz' | 'sog';
  const outputDir = String(opts.output || join(dir, 'output'));

  console.log(`\n📂 扫描目录: ${dir}`);
  const entries = await readdir(dir);
  const plyFiles = entries.filter(
    (f) => extname(f).toLowerCase() === '.ply',
  );

  if (plyFiles.length === 0) {
    console.log('   未找到 .ply 文件');
    return;
  }

  console.log(`   发现 ${plyFiles.length} 个 PLY 文件\n`);

  await mkdir(outputDir, { recursive: true });
  let successCount = 0;
  let failCount = 0;

  for (const file of plyFiles) {
    const inputPath = join(dir, file);
    const outputPath = join(outputDir, file.replace(/\.ply$/i, `.${format}`));

    try {
      console.log(`── ${file} ──`);
      await convertPly(inputPath, { ...opts, output: outputPath }, format);
      successCount++;
    } catch (err) {
      console.error(`   ❌ 失败: ${err instanceof Error ? err.message : err}`);
      failCount++;
    }
  }

  console.log(`\n📊 批量转换完成: ${successCount} 成功, ${failCount} 失败\n`);
}

/**
 * 生成 tour.json 配置模板
 *
 * 扫描目录下的场景文件, 生成完整的 tour.json 配置:
 *   - 版本和元信息
 *   - 默认相机和过渡动画设置
 *   - 每个场景的初始视角
 *   - 场景间导航热点 (自动链接相邻场景)
 *   - 热点扩展配置
 */
async function generateTour(
  dir: string,
  opts: Record<string, string>,
): Promise<void> {
  const baseUrl = opts.baseUrl || './';
  const outputPath = opts.output || 'tour.json';
  const title = opts.title || '3DGS 漫游';

  console.log(`\n📂 扫描目录: ${dir}`);
  const entries = await readdir(dir);
  const sceneFiles = entries.filter((f) => {
    const ext = extname(f).toLowerCase();
    return ['.splat', '.spz', '.sog', '.ply'].includes(ext);
  });

  if (sceneFiles.length === 0) {
    console.log('   未找到场景文件');
    return;
  }

  // 构建场景配置
  const scenes: Record<string, unknown> = {};
  const sceneIds: string[] = [];

  for (const file of sceneFiles) {
    const id = basename(file, extname(file));
    sceneIds.push(id);

    // 构建热点: 链接到相邻场景
    const hotspots: unknown[] = [];

    // 前一个场景 (返回)
    const prevIdx = sceneFiles.indexOf(file) - 1;
    if (prevIdx >= 0) {
      const prevId = basename(sceneFiles[prevIdx], extname(sceneFiles[prevIdx]));
      hotspots.push({
        id: `hotspot-to-${prevId}`,
        type: 'scene',
        position: [1.0, 1.5, -2.0],
        targetScene: prevId,
        transition: { type: 'fade', duration: 600 },
        style: { glow: true, pulse: true, color: '#80ff80', size: 36 },
        onHover: { tooltip: `进入 ${prevId}` },
      });
    }

    // 后一个场景 (前进)
    const nextIdx = sceneFiles.indexOf(file) + 1;
    if (nextIdx < sceneFiles.length) {
      const nextId = basename(sceneFiles[nextIdx], extname(sceneFiles[nextIdx]));
      hotspots.push({
        id: `hotspot-to-${nextId}`,
        type: 'scene',
        position: [-1.0, 1.5, -2.0],
        targetScene: nextId,
        transition: { type: 'fade', duration: 600 },
        style: { glow: true, pulse: true, color: '#80a0ff', size: 36 },
        onHover: { tooltip: `进入 ${nextId}` },
      });
    }

    // 信息热点
    hotspots.push({
      id: `hotspot-info-${id}`,
      type: 'text',
      position: [0.5, 1.2, -1.0],
      onHover: { tooltip: `${id} 场景` },
    });

    scenes[id] = {
      title: id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' '),
      source: `${baseUrl}${file}`,
      initialView: { yaw: 0, pitch: 0, fov: 60 },
      extensions: {
        hotspot: { hotspots },
      },
    };
  }

  const tour = {
    version: '1.0',
    meta: {
      title,
      description: `自动生成的 3DGS 漫游配置 (${sceneIds.length} 个场景)`,
    },
    defaults: {
      camera: {
        fov: 60,
        minFov: 30,
        maxFov: 90,
        limitPitch: [-80, 80],
      },
      transition: {
        type: 'fade',
        duration: 800,
      },
    },
    scenes,
  };

  await writeFile(outputPath, JSON.stringify(tour, null, 2), 'utf-8');
  console.log(`\n✅ 生成配置: ${outputPath}`);
  console.log(`   场景数: ${sceneIds.length}`);
  console.log(`   场景列表: ${sceneIds.join(', ')}`);
  console.log(`   热点: 自动链接相邻场景\n`);
}

/**
 * 显示文件信息
 */
async function showInfo(input: string): Promise<void> {
  const buffer = await readFile(input);
  const ext = extname(input).toLowerCase();

  console.log(`\n📄 文件: ${input}`);
  console.log(`   大小: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   格式: ${ext}\n`);

  switch (ext) {
    case '.splat': {
      const numSplats = Math.floor(buffer.byteLength / 32);
      console.log(`   类型: antimatter15/splat`);
      console.log(`   高斯核数: ${numSplats.toLocaleString()}`);
      break;
    }
    case '.spz': {
      console.log(`   类型: Niantic SPZ (gzip 压缩)`);
      console.log(`   (解压后可查看详细信息)`);
      break;
    }
    case '.sog': {
      const meta = parseSogMetadata(buffer.buffer);
      console.log(`   类型: Spatially Ordered Gaussians`);
      console.log(`   高斯核数: ${meta.numSplats.toLocaleString()}`);
      console.log(`   分块数: ${meta.numChunks}`);
      console.log(`   每块大小: ${meta.chunkSize} splats`);
      console.log(`   SH 阶数: ${meta.shDegree}`);
      console.log(`   包围盒: [${meta.bboxMin.join(', ')}] → [${meta.bboxMax.join(', ')}]`);
      break;
    }
    case '.ply': {
      const cloud = loadGaussiansFromPly(buffer.buffer, { source: input });
      console.log(`   类型: PLY (Polygon File Format)`);
      console.log(`   高斯核数: ${cloud.vertexCount.toLocaleString()}`);
      console.log(`   SH 阶数: ${cloud.shDegree}`);
      break;
    }
    default:
      console.log(`   未知格式`);
  }
  console.log('');
}

/**
 * 生成默认输出路径
 */
function defaultOutputPath(input: string, format: string): string {
  const dir = dirname(input);
  const name = basename(input, extname(input));
  return join(dir, `${name}.${format}`);
}

// ── 启动 CLI ──
// 仅在直接执行时运行 (非 import)
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('cli.js');

if (isMain) {
  program.parse();
}

export { program as cli };
