#!/usr/bin/env node
/**
 * @3dgs/convert CLI — 3DGS 数据转换命令行工具
 *
 * 命令:
 *   ply-to-splat <input.ply>   转换 PLY 为 .splat 格式
 *   ply-to-spz <input.ply>     转换 PLY 为 .spz 格式 (gzip 压缩)
 *   ply-to-sog <input.ply>     转换 PLY 为 .sog 格式 (流式 LOD)
 *   splat-to-spz <input.splat> 转换 .splat 为 .spz 格式
 *   splat-to-sog <input.splat> 转换 .splat 为 .sog 格式
 *   batch <dir>                批量转换目录下所有 .ply 文件
 *   generate-tour <dir>        生成 tour.json 配置模板
 *
 * [来源: commander.js — github.com/tj/commander.js]
 */

import { Command } from 'commander';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';

/** ★ 3.9: CLI 版本号对齐包版本 (源态/编译态均解析到 packages/convert/package.json) */
const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  .version as string;

import {
  loadGaussiansFromPlySoA,
  loadGaussiansFromSplatSoA,
  loadGaussiansFromSpzSoA,
  loadGaussiansFromSogSoA,
  writeSplatSoA,
  writeSpzSoA,
  writeSogSoA,
  pruneGaussiansSoA,
  mortonSortSoA,
  parseSogMetadata,
  parseSpzHeader,
  writeCompressedPlySoA,
} from './index.js';
import type { GaussianCloudSoA } from './gaussian-loader.js';

const program = new Command();

/**
 * ★ D-03: 将 Node Buffer 安全转换为独立 ArrayBuffer。
 *
 * `fs.readFile` 返回的 Buffer 可能来自共享内存池 (byteOffset !== 0),
 * 此时 `.buffer` 暴露的是整个池的 ArrayBuffer — 解析器会读到错误偏移的
 * 数据或越界 (小文件高发)。统一切片出精确范围, 杠绝该隐患。
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  // 拷贝为独立视图, 同时规避 Buffer.buffer 的 ArrayBufferLike (SharedArrayBuffer) 类型问题
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

program
  .name('3dgs-convert')
  .description('3DGS 数据转换 CLI — PLY → SPLAT / SPZ / SOG')
  .version(PKG_VERSION);

// ── ply-to-splat ──
program
  .command('ply-to-splat')
  .description('转换 PLY 为 .splat 格式 (32 字节/splat)')
  .argument('<input>', 'PLY 文件路径')
  .option('-o, --output <path>', '输出文件路径')
  .option('--prune', '启用冗余剔除 (过滤低透明度/异常高斯核)')
  .option('--min-opacity <num>', '最小不透明度阈值 (默认 0.01)', '0.01')
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
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
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
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
  .option('--chunk-size <num>', '每 chunk 的 splat 数 (默认 8192)', '8192')
  .option('--prune', '启用冗余剔除')
  .option('--min-opacity <num>', '最小不透明度阈值', '0.01')
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
  .option('--sh-mode <num>', '★ H2: SH DC 追加模式 (0=off, 1=Int8, 默认 0)')
  .option('--sog-version <num>', '★ C-04: SOG 版本 (2 或 3, 默认 2; 3 = 尾部 SH overlay)')
  .option('--no-sort', '禁用 Morton Code 空间排序 (SOG 默认启用)')
  .action(async (input: string, opts: Record<string, string>) => {
    await convertPly(input, opts, 'sog');
  });

// ── splat-to-spz ──
program
  .command('splat-to-spz')
  .description('转换 .splat 为 .spz 格式 (gzip 压缩)')
  .argument('<input>', '.splat 文件路径')
  .option('-o, --output <path>', '输出文件路径')
  .option('--fractional-bits <num>', '位置量化小数位 (默认 12)', '12')
  .option('--prune', '启用冗余剔除')
  .option('--min-opacity <num>', '最小不透明度阈值', '0.01')
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
  .option('--sort', '启用 Morton Code 空间排序')
  .action(async (input: string, opts: Record<string, string>) => {
    await convertSplat(input, opts, 'spz');
  });

// ── splat-to-sog ──
program
  .command('splat-to-sog')
  .description('转换 .splat 为 .sog 格式 (流式 LOD)')
  .argument('<input>', '.splat 文件路径')
  .option('-o, --output <path>', '输出文件路径')
  .option('--chunk-size <num>', '每 chunk 的 splat 数 (默认 8192)', '8192')
  .option('--prune', '启用冗余剔除')
  .option('--min-opacity <num>', '最小不透明度阈值', '0.01')
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
  .option('--sog-version <num>', '★ C-04: SOG 版本 (2 或 3, 默认 2; 3 = 尾部 SH overlay)')
  .option('--no-sort', '禁用 Morton Code 空间排序 (SOG 默认启用)')
  .action(async (input: string, opts: Record<string, string>) => {
    await convertSplat(input, opts, 'sog');
  });

program
  .command('to-compressed-ply <input>')
  .description('★ C-05: 转换为 SuperSplat 兼容的压缩 PLY')
  .option('-o, --output <file>', '输出文件路径 (默认: 输入名 + .compressed.ply)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
  .option('--min-opacity <num>', '最小不透明度阈值', '0.01')
  .option('--prune', '启用冗余剔除')
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .action(async (input: string, opts: Record<string, string>) => {
    // ★ security: 默认输出名 — 已知扩展名替换为 .compressed.ply,
    //   未知/无扩展名时追加后缀, 避免 output === input 覆盖原始文件
    const defaultOut = input.replace(/\.(ply|splat|spz|sog)$/i, '.compressed.ply');
    const output = String(
      opts.output || (defaultOut === input ? `${input}.compressed.ply` : defaultOut),
    );
    const startTime = Date.now();
    const buffer = await readFile(input);
    let soa = await loadCloudFromAnySoA(input, buffer);

    // ★ 复用 convertCloudSoA 的预裁剪契约 (--prune + --contribution-cutoff + --max-splats)
    if (opts.prune) {
      const minOpacity = parseFloat(String(opts.minOpacity || '0.01'));
      const before = soa.count;
      const pruneOpts: import('./processing.js').PruneOptions = { minOpacity };
      if (opts.contributionCutoff !== undefined) {
        const cutoff = parseFloat(String(opts.contributionCutoff));
        if (!isNaN(cutoff) && cutoff > 0) pruneOpts.contributionCutoff = cutoff;
      }
      soa = pruneGaussiansSoA(soa, pruneOpts);
      const removed = before - soa.count;
      console.log(
        `🗑️  冗余剔除: 移除 ${removed.toLocaleString()} 个 (${((removed / before) * 100).toFixed(1)}%)`,
      );
    }
    if (opts.maxSplats !== undefined) {
      const maxSplats = parseInt(String(opts.maxSplats), 10);
      if (!isNaN(maxSplats) && maxSplats > 0 && soa.count > maxSplats) {
        const before = soa.count;
        soa = pruneGaussiansSoA(soa, { contributionCutoff: maxSplats, minOpacity: 0 });
        const after = soa.count;
        console.log(
          `✂️  预裁剪 (--max-splats ${maxSplats.toLocaleString()}): ` +
            `${before.toLocaleString()} → ${after.toLocaleString()} 个 ` +
            `(保留 ${((after / before) * 100).toFixed(1)}%)`,
        );
      }
    }

    // ★ 3.4: 压缩 PLY 不保留 SH (SuperSplat 布局无 SH element), 明确提示损失
    if (soa.shDegree > 0) {
      console.log(`⚠️ 压缩 PLY 不保留 SH: 源 SH degree ${soa.shDegree} 将被丢弃`);
    }

    const plyBytes = writeCompressedPlySoA(soa, { source: input });
    await writeFile(output, Buffer.from(plyBytes));
    const elapsed = Date.now() - startTime;
    const mb = (plyBytes.byteLength / (1024 * 1024)).toFixed(2);
    console.log(
      `✅ 压缩 PLY: ${soa.count.toLocaleString()} splats → ${output} (${mb} MB, ${elapsed}ms)`,
    );
  });

program
  .command('batch')
  .description('批量转换目录下所有 .ply 文件')
  .argument('<dir>', '输入目录')
  .option('-f, --format <format>', '输出格式 (splat/spz/sog)', 'spz')
  .option('-o, --output <dir>', '输出目录 (默认 <dir>/output)')
  .option('--sh-degree <num>', 'SH 阶数 (0-3, 默认自动检测)', '-1')
  .option('--prune', '启用冗余剔除')
  .option('--sort', '启用 Morton Code 空间排序')
  .option('--contribution-cutoff <num>', '★ M3: 贡献度裁剪 (0-1=保留比例, >1=保留数量)')
  .option('--max-splats <num>', '★ C-07: 转换期按贡献度裁剪到最多 N 个 splat')
  .option('--sog-version <num>', '★ C-04: SOG 版本 (2 或 3, 默认 2)')
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
  .option('--title <title>', '漫游标题 (默认 3DGS 漫游)')
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
): Promise<number> {
  const startTime = Date.now();
  console.log(`\n📋 读取 PLY: ${input}`);

  const plyBuffer = await readFile(input);
  const plySize = plyBuffer.byteLength;
  console.log(`   文件大小: ${(plySize / 1024 / 1024).toFixed(2)} MB`);

  // 解析 PLY (★ D-03: 安全切片, 避免 Buffer 池多余字节)
  console.log('🔍 解析 PLY...');
  const soa = loadGaussiansFromPlySoA(toArrayBuffer(plyBuffer), { source: input });
  console.log(`   高斯核数: ${soa.count.toLocaleString()}`);
  console.log(`   SH 阶数: ${soa.shDegree}`);

  const splatCount = await convertCloudSoA(soa, opts, format, input, plySize, startTime);
  return splatCount;
}

/**
 * 转换 .splat 文件
 */
async function convertSplat(
  input: string,
  opts: Record<string, string | boolean>,
  format: 'splat' | 'spz' | 'sog',
): Promise<number> {
  const startTime = Date.now();
  console.log(`\n📋 读取 SPLAT: ${input}`);

  const splatBuffer = await readFile(input);
  const splatSize = splatBuffer.byteLength;
  console.log(`   文件大小: ${(splatSize / 1024 / 1024).toFixed(2)} MB`);

  // 解析 .splat (★ D-03: 安全切片, 避免 Buffer 池多余字节)
  console.log('🔍 解析 SPLAT...');
  const soa = loadGaussiansFromSplatSoA(toArrayBuffer(splatBuffer), { source: input });
  console.log(`   高斯核数: ${soa.count.toLocaleString()}`);
  console.log(`   SH 阶数: ${soa.shDegree} (.splat 不含 SH)`);

  const splatCount = await convertCloudSoA(soa, opts, format, input, splatSize, startTime);
  return splatCount;
}

/**
 * 通用转换核心 — 接受已解析的 GaussianCloudSoA, 执行剔除/排序/写入
 */
async function convertCloudSoA(
  soa: import('./gaussian-loader.js').GaussianCloudSoA,
  opts: Record<string, string | boolean>,
  format: 'splat' | 'spz' | 'sog',
  input: string,
  inputSize: number,
  startTime: number,
): Promise<number> {
  // 冗余剔除
  if (opts.prune) {
    const minOpacity = parseFloat(String(opts.minOpacity || '0.01'));
    const before = soa.count;
    const pruneOpts: import('./processing.js').PruneOptions = { minOpacity };
    // ★ M3: 贡献度裁剪
    if (opts.contributionCutoff !== undefined) {
      const cutoff = parseFloat(String(opts.contributionCutoff));
      if (!isNaN(cutoff) && cutoff > 0) {
        pruneOpts.contributionCutoff = cutoff;
      }
    }
    soa = pruneGaussiansSoA(soa, pruneOpts);
    const removed = before - soa.count;
    console.log(
      `🗑️  冗余剔除: 移除 ${removed.toLocaleString()} 个 (${((removed / before) * 100).toFixed(1)}%)`,
    );
  }

  // ★ C-07: 转换期按贡献度预裁剪 (--max-splats)
  // 独立于 --prune, 无 prune 时也可单独使用; 贡献度 = opacity × max(scale)
  if (opts.maxSplats !== undefined) {
    const maxSplats = parseInt(String(opts.maxSplats), 10);
    if (!isNaN(maxSplats) && maxSplats > 0 && soa.count > maxSplats) {
      const before = soa.count;
      soa = pruneGaussiansSoA(soa, { contributionCutoff: maxSplats, minOpacity: 0 });
      const after = soa.count;
      console.log(
        `✂️  预裁剪 (--max-splats ${maxSplats.toLocaleString()}): ` +
          `${before.toLocaleString()} → ${after.toLocaleString()} 个 ` +
          `(保留 ${((after / before) * 100).toFixed(1)}%)`,
      );
    }
  }

  // Morton 排序
  // 对于 SOG 格式, 默认启用排序 (--no-sort 可禁用)
  // 对于 splat/spz 格式, 仅在 --sort 时启用
  const shouldSort = format === 'sog' ? opts.sort !== false : !!opts.sort;
  if (shouldSort) {
    console.log('🔄 Morton Code 空间排序...');
    soa = mortonSortSoA(soa);
  }

  // 确定输出路径
  const outputPath = String(opts.output || defaultOutputPath(input, format));

  // 写入目标格式
  console.log(`📦 转换为 ${format.toUpperCase()}...`);

  let outputData: ArrayBuffer | Uint8Array;

  switch (format) {
    case 'splat': {
      outputData = writeSplatSoA(soa);
      break;
    }
    case 'spz': {
      const shDegree = parseInt(String(opts.shDegree || '-1'), 10);
      const fractionalBits = parseInt(String(opts.fractionalBits || '12'), 10);
      outputData = await writeSpzSoA(soa, {
        shDegree: shDegree >= 0 ? shDegree : undefined,
        fractionalBits,
      });
      break;
    }
    case 'sog': {
      const chunkSize = parseInt(String(opts.chunkSize || '8192'), 10);
      const shMode = parseInt(String(opts.shMode || '0'), 10);
      // ★ C-04: SOG 版本 (2/3), 默认 2
      const sogVersion = parseInt(String(opts.sogVersion || '2'), 10) === 3 ? 3 : 2;
      // SOG 已在上方完成 Morton 排序, 此处无需重复
      outputData = writeSogSoA(soa, {
        chunkSize,
        spatialSort: false,
        shMode,
        version: sogVersion,
      });
      console.log(`   SOG 版本: v${sogVersion}`);
      break;
    }
  }

  // 写入文件
  await mkdir(dirname(outputPath), { recursive: true });
  const dataToWrite =
    outputData instanceof Uint8Array ? Buffer.from(outputData) : Buffer.from(outputData);
  await writeFile(outputPath, dataToWrite);

  const outputSize = dataToWrite.byteLength;
  const compressionRatio = inputSize / outputSize;
  const elapsed = Date.now() - startTime;

  console.log(`\n✅ 转换完成!`);
  console.log(`   输出: ${outputPath}`);
  console.log(`   大小: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   压缩比: ${compressionRatio.toFixed(2)}×`);
  console.log(`   耗时: ${elapsed}ms\n`);

  // ★ 返回裁剪后实际 splat 数 (prune/max-splats 可能已重赋 soa)
  return soa.count;
}

/**
 * ★ C-05: 从任意受支持格式 (PLY/SPLAT/SPZ/SOG) 加载 GaussianCloudSoA
 */
async function loadCloudFromAnySoA(input: string, buffer: Buffer): Promise<GaussianCloudSoA> {
  const ext = extname(input).toLowerCase();
  if (ext === '.ply') {
    return loadGaussiansFromPlySoA(toArrayBuffer(buffer), { source: input });
  }
  if (ext === '.splat') {
    return loadGaussiansFromSplatSoA(toArrayBuffer(buffer), { source: input });
  }
  if (ext === '.spz') {
    return await loadGaussiansFromSpzSoA(new Uint8Array(toArrayBuffer(buffer)), { source: input });
  }
  if (ext === '.sog') {
    return loadGaussiansFromSogSoA(toArrayBuffer(buffer), { source: input });
  }
  throw new Error(`不支持的输入格式: ${ext} (支持 .ply/.splat/.spz/.sog)`);
}

/**
 * 批量转换
 *
 * ★ C-10: 支持多输入格式 (PLY/SPLAT/SPZ/SOG), 输出 manifest JSON。
 */
async function batchConvert(dir: string, opts: Record<string, string | boolean>): Promise<void> {
  const format = String(opts.format) as 'splat' | 'spz' | 'sog';
  const outputDir = String(opts.output || join(dir, 'output'));

  console.log(`\n📂 扫描目录: ${dir}`);
  const entries = await readdir(dir);
  const supportedExts = ['.ply', '.splat', '.spz', '.sog'];
  const inputFiles = entries
    .filter((f) => supportedExts.includes(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  if (inputFiles.length === 0) {
    console.log('   未找到场景文件 (支持 .ply/.splat/.spz/.sog)');
    return;
  }

  console.log(`   发现 ${inputFiles.length} 个输入文件\n`);

  await mkdir(outputDir, { recursive: true });
  let successCount = 0;
  let failCount = 0;
  const usedOutputs = new Set<string>();
  const manifest: Array<{
    input: string;
    output: string;
    count: number;
    format: string;
    elapsedMs: number;
  }> = [];

  for (const file of inputFiles) {
    const inputPath = join(dir, file);
    const inputExt = extname(file).toLowerCase();

    // ★ 3.3: 输出名碰撞时追加 -1/-2/... 后缀, 保证 manifest 输出唯一
    const base = file.replace(/\.(ply|splat|spz|sog)$/i, `.${format}`);
    let outputFile = base;
    let suffix = 1;
    while (usedOutputs.has(outputFile)) {
      outputFile = base.replace(new RegExp(`\\.${format}$`, 'i'), `-${suffix}.${format}`);
      suffix++;
    }
    usedOutputs.add(outputFile);
    const outputPath = join(outputDir, outputFile);

    const startTime = Date.now();
    let splatCount = -1;

    try {
      console.log(`── ${file} ──`);
      // ★ C-10: 按输入扩展名路由到对应加载器
      const inputOpts = { ...opts, output: outputPath };
      if (inputExt === '.ply') {
        // ★ 复用返回值, 避免二次 readFile + 解析
        splatCount = await convertPly(inputPath, inputOpts, format);
      } else if (inputExt === '.splat') {
        splatCount = await convertSplat(inputPath, inputOpts, format);
      } else if (inputExt === '.spz') {
        // SPZ → 目标格式: 解压读取后走通用转换
        const spzBuf = await readFile(inputPath);
        const soa = await loadGaussiansFromSpzSoA(new Uint8Array(toArrayBuffer(spzBuf)), {
          source: inputPath,
        });
        splatCount = await convertCloudSoA(
          soa,
          inputOpts,
          format,
          inputPath,
          spzBuf.byteLength,
          startTime,
        );
      } else if (inputExt === '.sog') {
        // SOG → 目标格式: 通过公共读回 API (保留 v3 SH overlay) 重建
        const sogBuf = await readFile(inputPath);
        const soa = loadGaussiansFromSogSoA(toArrayBuffer(sogBuf), { source: inputPath });
        splatCount = await convertCloudSoA(
          soa,
          inputOpts,
          format,
          inputPath,
          sogBuf.byteLength,
          startTime,
        );
      } else {
        throw new Error(`不支持的输入格式: ${inputExt}`);
      }
      successCount++;
    } catch (err) {
      console.error(`   ❌ 失败: ${err instanceof Error ? err.message : err}`);
      failCount++;
    }

    manifest.push({
      input: file,
      output: outputPath,
      count: splatCount,
      format,
      elapsedMs: Date.now() - startTime,
    });
  }

  // ★ C-10: 输出 manifest JSON
  const manifestPath = join(outputDir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        format,
        successCount,
        failCount,
        files: manifest,
      },
      null,
      2,
    ),
  );

  console.log(
    `\n📊 批量转换完成: ${successCount} 成功, ${failCount} 失败\n` +
      `   📄 Manifest: ${manifestPath}`,
  );
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
async function generateTour(dir: string, opts: Record<string, string>): Promise<void> {
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
        // TD-16: Use center-based position instead of hardcoded values
        position: [0.5, 1.5, -1.0],
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
        // TD-16: Use center-based position instead of hardcoded values
        position: [-0.5, 1.5, -1.0],
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
      const header = await parseSpzHeader(new Uint8Array(toArrayBuffer(buffer)));
      console.log(
        `   类型: Niantic SPZ ${header.container === 'ngsp' ? `v${header.version} (NGSP+zstd)` : `v${header.version} (gzip)`}`,
      );
      console.log(`   高斯核数: ${header.numPoints.toLocaleString()}`);
      console.log(`   SH 阶数: ${header.shDegree}`);
      console.log(`   位置量化: ${header.fractionalBits} bits`);
      break;
    }
    case '.sog': {
      const meta = parseSogMetadata(toArrayBuffer(buffer));
      console.log(`   类型: Spatially Ordered Gaussians`);
      console.log(`   高斯核数: ${meta.numSplats.toLocaleString()}`);
      console.log(`   分块数: ${meta.numChunks}`);
      console.log(`   每块大小: ${meta.chunkSize} splats`);
      console.log(`   SH 阶数: ${meta.shDegree}`);
      console.log(`   包围盒: [${meta.bboxMin.join(', ')}] → [${meta.bboxMax.join(', ')}]`);
      break;
    }
    case '.ply': {
      const soa = loadGaussiansFromPlySoA(toArrayBuffer(buffer), { source: input });
      console.log(`   类型: PLY (Polygon File Format)`);
      console.log(`   高斯核数: ${soa.count.toLocaleString()}`);
      console.log(`   SH 阶数: ${soa.shDegree}`);
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
const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js');

if (isMain) {
  program.parse();
}

export { program as cli };
