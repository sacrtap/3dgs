/**
 * ★ C-07: CLI 冒烟测试 — --max-splats 预裁剪 + 质量回执
 *
 * 用子进程执行真实 CLI (tsx packages/convert/src/cli.ts), 验证:
 *   1. --max-splats 后输出 splat 数 ≤ N
 *   2. 回执输出包含 原始数 → 裁剪数 → 保留比例
 *   3. --prune 与 --max-splats 可组合
 *   4. --sog-version 3 生成 v3 文件 (parseSogMetadata 版本=3)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSogMetadata } from './sog-writer.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliEntry = join(repoRoot, 'packages', 'convert', 'src', 'cli.ts');

/** 生成 N 顶点标准 3DGS 二进制 PLY */
function make3dgsPlyFile(path: string, count: number): void {
  const props = [
    'property float x',
    'property float y',
    'property float z',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'property float opacity',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
  ];
  for (let j = 0; j < 9; j++) props.push(`property float f_rest_${j}`);

  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.join(
    '\n',
  )}\nend_header\n`;
  const headerBytes = new TextEncoder().encode(header);

  // 每顶点 23 个 float; 用不同贡献度 (opacity × scale) 便于验证裁剪保留高分
  const floatsPerVertex = 23;
  const body = new Float32Array(count * floatsPerVertex);
  for (let i = 0; i < count; i++) {
    const o = i * floatsPerVertex;
    body[o + 0] = i * 0.1; // x
    body[o + 1] = i * 0.05; // y
    body[o + 2] = (i % 5) * 2; // z
    body[o + 3] = Math.log(0.1 + (i % 7) * 0.05); // scale_0 (可区分贡献度)
    body[o + 4] = Math.log(0.1);
    body[o + 5] = Math.log(0.1);
    body[o + 6] = 1; // rot w
    body[o + 7] = 0;
    body[o + 8] = 0;
    body[o + 9] = 0;
    body[o + 10] = i % 3 === 0 ? 10 : 0; // opacity logit (≈ sigmoid → 高分素保留)
    body[o + 11] = 0; // f_dc
    body[o + 12] = 0;
    body[o + 13] = 0;
    for (let j = 0; j < 9; j++) body[o + 14 + j] = 0;
  }

  const buffer = new ArrayBuffer(headerBytes.length + body.byteLength);
  new Uint8Array(buffer).set(headerBytes, 0);
  new Uint8Array(buffer).set(new Uint8Array(body.buffer), headerBytes.length);
  writeFileSync(path, Buffer.from(buffer));
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), '3dgs-cli-c07-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('C-07 CLI --max-splats', () => {
  it('--max-splats 裁剪: 输出 splat 数 ≤ N 且回执正确', () => {
    const ply = join(tmpDir, 'garden.ply');
    const splatOut = join(tmpDir, 'cut.splat');
    make3dgsPlyFile(ply, 50);

    const out = runCli(['ply-to-splat', ply, '-o', splatOut, '--max-splats', '10']);

    // 回执
    expect(out).toMatch(/预裁剪/);
    expect(out).toMatch(/50 → 10/);
    expect(out).toMatch(/保留 20\.0%/);

    // 产物 splat 数 = 10 (32B/个)
    const size = readFileSync(splatOut).byteLength;
    expect(size).toBe(10 * 32);
  });

  it('--max-splats 大于总数时不做裁剪', () => {
    const ply = join(tmpDir, 'small.ply');
    const splatOut = join(tmpDir, 'nocut.splat');
    make3dgsPlyFile(ply, 5);

    const out = runCli(['ply-to-splat', ply, '-o', splatOut, '--max-splats', '100']);
    expect(out).not.toMatch(/预裁剪/);
    expect(readFileSync(splatOut).byteLength).toBe(5 * 32);
  });

  it('--prune 与 --max-splats 组合: 先剔除后按贡献裁剪', () => {
    const ply = join(tmpDir, 'combo.ply');
    const splatOut = join(tmpDir, 'combo.splat');
    make3dgsPlyFile(ply, 50);

    const out = runCli(['ply-to-splat', ply, '-o', splatOut, '--prune', '--max-splats', '8']);

    expect(out).toMatch(/冗余剔除/);
    expect(out).toMatch(/预裁剪/);
    expect(readFileSync(splatOut).byteLength).toBe(8 * 32);
  });

  it('ply-to-spz 同样支持 --max-splats', () => {
    const ply = join(tmpDir, 'spz.ply');
    const spzOut = join(tmpDir, 'cut.spz');
    make3dgsPlyFile(ply, 30);

    const out = runCli(['ply-to-spz', ply, '-o', spzOut, '--max-splats', '6']);
    expect(out).toMatch(/6 个/);
    expect(readFileSync(spzOut).byteLength).toBeGreaterThan(0);
  });

  it('--sog-version 3 生成 v3 文件', () => {
    const ply = join(tmpDir, 'v3.ply');
    const sogOut = join(tmpDir, 'out.sog');
    make3dgsPlyFile(ply, 12);

    const out = runCli(['ply-to-sog', ply, '-o', sogOut, '--sog-version', '3']);
    expect(out).toMatch(/SOG 版本: v3/);

    const buf = readFileSync(sogOut);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const meta = parseSogMetadata(ab);
    expect(meta.version).toBe(3);
    // 源 PLY 有 SH degree 1 (f_rest_0..8) → overlay 存在
    expect(meta.shOverlaySize).toBe(12 * 9);
  });
});
// ── C-10: batch 多格式 + manifest ─────────────────────────

import { writeSplat, writeSpz, writeSog } from './index.js';
import { loadGaussiansFromPly } from './gaussian-loader.js';
import { loadGaussiansFromSplat } from './splat-reader.js';

describe('C-10 batch CLI 多格式 + manifest', () => {
  it('混合格式目录 batch: 扫描 PLY/SPLAT/SPZ/SOG 并输出 manifest', async () => {
    // 独立子目录, 避免与其它用例共享 tmpDir 引入额外文件
    const batchDir = join(tmpDir, 'c10-in');
    const outDir = join(tmpDir, 'c10-out');
    mkdirSync(batchDir, { recursive: true });

    // 构造 4 个输入文件 (各格式 1 个)
    const plyPath = join(batchDir, 'b1.ply');
    make3dgsPlyFile(plyPath, 8);
    const plyBuf = readFileSync(plyPath);
    const cloudA = loadGaussiansFromPly(
      plyBuf.buffer.slice(plyBuf.byteOffset, plyBuf.byteOffset + plyBuf.byteLength) as ArrayBuffer,
    );
    writeFileSync(join(batchDir, 'b2.splat'), Buffer.from(writeSplat(cloudA)));
    const spzBytes = await writeSpz(cloudA);
    writeFileSync(join(batchDir, 'b3.spz'), Buffer.from(spzBytes));
    const sogBytes = writeSog(cloudA, { version: 2, buildLodTree: false });
    writeFileSync(join(batchDir, 'b4.sog'), Buffer.from(sogBytes));

    const out = runCli(['batch', batchDir, '-o', outDir, '-f', 'spz']);

    expect(out).toMatch(/批量转换完成: 4 成功, 0 失败/);
    expect(out).toMatch(/Manifest/);

    // manifest 内容
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.successCount).toBe(4);
    expect(manifest.failCount).toBe(0);
    expect(manifest.format).toBe('spz');
    expect(manifest.files).toHaveLength(4);
    expect(manifest.files.map((f: { input: string }) => f.input).sort()).toEqual([
      'b1.ply',
      'b2.splat',
      'b3.spz',
      'b4.sog',
    ]);
    // 每个输出都有对应 spz
    for (const f of manifest.files) {
      expect(readFileSync(f.output).byteLength).toBeGreaterThan(0);
    }
  });

  it('batch 输出 manifest 含 count 字段', async () => {
    const batchDir = join(tmpDir, 'c10-count');
    const outDir = join(tmpDir, 'c10-count-out');
    mkdirSync(batchDir, { recursive: true });

    const plyPath = join(batchDir, 'bcount.ply');
    make3dgsPlyFile(plyPath, 12);
    runCli(['batch', batchDir, '-o', outDir, '-f', 'splat']);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    const b1 = manifest.files.find((f: { input: string }) => f.input === 'bcount.ply');
    expect(b1.count).toBe(12);
    expect(b1.format).toBe('splat');
  });

  it('★ 紧凑 SOG (positionQuantization=1) → splat: 29B 布局 + chunk bbox 反量化 round-trip', async () => {
    // critical 回归: decodeSogToCloud 曾固定 32B 步长导致紧凑文件从第 2 个 splat 起字段错位
    const batchDir = join(tmpDir, 'c10-compact');
    const outDir = join(tmpDir, 'c10-compact-out');
    mkdirSync(batchDir, { recursive: true });

    // 构造紧凑 SOG (29B/splat: 3×Uint24 量化位置 + chunk 内嵌 24B bbox)
    // 源 PLY 放在 batch 目录之外, 避免 batch 扫描到它 (batch 处理目录内所有格式文件)
    const plyPath = join(tmpDir, 'c10-compact-src.ply');
    mkdirSync(batchDir, { recursive: true });
    make3dgsPlyFile(plyPath, 16);
    const plyBuf = readFileSync(plyPath);
    const cloud = loadGaussiansFromPly(
      plyBuf.buffer.slice(plyBuf.byteOffset, plyBuf.byteOffset + plyBuf.byteLength) as ArrayBuffer,
    );
    const sogBytes = writeSog(cloud, {
      version: 2,
      compression: false,
      positionQuantization: true,
      buildLodTree: false,
      spatialSort: false, // 保持源顶点顺序, 便于按索引对比 (默认 Morton 排序会重排)
    });
    writeFileSync(join(batchDir, 'compact.sog'), Buffer.from(sogBytes));

    // 紧凑 SOG → splat 转换 (走 decodeSogToCloud)
    runCli(['batch', batchDir, '-o', outDir, '-f', 'splat']);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.successCount).toBe(1);
    expect(manifest.files[0].count).toBe(16);

    // 读回 splat 产物并与源 cloud 对比 (字段顺序必须正确, 而非仅数量)
    const splatOut = readFileSync(manifest.files[0].output);
    const readBack = loadGaussiansFromSplat(
      splatOut.buffer.slice(
        splatOut.byteOffset,
        splatOut.byteOffset + splatOut.byteLength,
      ) as ArrayBuffer,
    );
    expect(readBack.vertexCount).toBe(16);
    // 抽查顶点 0 与顶点 8 (跨 chunk 边界): 量化容差内一致
    const s0 = readBack.splats[0];
    const src0 = cloud.splats[0];
    expect(Math.abs(s0.x - src0.x)).toBeLessThan(1e-3);
    expect(Math.abs(s0.y - src0.y)).toBeLessThan(1e-3);
    expect(Math.abs(s0.scaleX - src0.scaleX)).toBeLessThan(1e-4);
    expect(Math.abs(s0.rotW - src0.rotW)).toBeLessThan(1e-2);
    expect(Math.abs(s0.colorR - src0.colorR)).toBeLessThan(1 / 255 + 1e-6);
    const s8 = readBack.splats[8];
    const src8 = cloud.splats[8];
    expect(Math.abs(s8.x - src8.x)).toBeLessThan(1e-3);
    expect(Math.abs(s8.y - src8.y)).toBeLessThan(1e-3);
    expect(Math.abs(s8.scaleZ - src8.scaleZ)).toBeLessThan(1e-4);
    expect(Math.abs(s8.opacity - src8.opacity)).toBeLessThan(1 / 255 + 1e-6);
  });
});

// ── C-05: to-compressed-ply CLI ──────────────────────────

describe('C-05 to-compressed-ply CLI', () => {
  it('PLY → 压缩 PLY: 产物可被本包读回, 输出回执含 splats 数', () => {
    const ply = join(tmpDir, 'c05-in.ply');
    const out = join(tmpDir, 'c05-out.ply');
    make3dgsPlyFile(ply, 30);

    const stdout = runCli(['to-compressed-ply', ply, '-o', out]);
    expect(stdout).toMatch(/压缩 PLY: 30 splats/);

    const buf = readFileSync(out);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const read = loadGaussiansFromPly(ab);
    expect(read.vertexCount).toBe(30);
    // 头部含 packed_* 属性 (SuperSplat 布局)
    const header = buf.subarray(0, 300).toString('utf8');
    expect(header).toContain('packed_position');
  });

  it('SPLAT → 压缩 PLY 同样可用', () => {
    const ply = join(tmpDir, 'c05b.ply');
    const splatPath = join(tmpDir, 'c05b.splat');
    make3dgsPlyFile(ply, 12);
    runCli(['ply-to-splat', ply, '-o', splatPath]);

    const out = join(tmpDir, 'c05b-out.ply');
    runCli(['to-compressed-ply', splatPath, '-o', out]);
    const buf = readFileSync(out);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(loadGaussiansFromPly(ab).vertexCount).toBe(12);
  });

  it('★ to-compressed-ply --max-splats 预裁剪生效 (产物 splats ≤ N)', () => {
    const ply = join(tmpDir, 'c05c.ply');
    const out = join(tmpDir, 'c05c-out.ply');
    make3dgsPlyFile(ply, 60);

    // 裁剪到 20: 回执应显示预裁剪 + 产物读回 = 20
    const stdout = runCli(['to-compressed-ply', ply, '-o', out, '--max-splats', '20']);
    expect(stdout).toMatch(/预裁剪 \(--max-splats 20\)/);
    expect(stdout).toMatch(/压缩 PLY: 20 splats/);

    const buf = readFileSync(out);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(loadGaussiansFromPly(ab).vertexCount).toBe(20);
  });

  it('★ to-compressed-ply --prune + --contribution-cutoff 组合生效', () => {
    const ply = join(tmpDir, 'c05d.ply');
    const out = join(tmpDir, 'c05d-out.ply');
    make3dgsPlyFile(ply, 30);

    const stdout = runCli([
      'to-compressed-ply',
      ply,
      '-o',
      out,
      '--prune',
      '--contribution-cutoff',
      '0.5', // 保留贡献度前 50% (按数量 ≈ 15)
    ]);
    expect(stdout).toMatch(/冗余剔除/);
    // 产物数量 < 输入 (裁剪生效)
    const buf = readFileSync(out);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const read = loadGaussiansFromPly(ab);
    expect(read.vertexCount).toBeLessThan(30);
    expect(read.vertexCount).toBeGreaterThan(0);
  });
});
