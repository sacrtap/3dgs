/**
 * 转换质量数值分析 — 原始文件 vs 转换产物逐属性对比
 *
 * 对每个源文件: 用转换器解析源 → 解析转换产物 → 逐属性采样对比:
 *   位置 (绝对误差) / 缩放 (相对误差) / 旋转 (角度误差) / 颜色 (绝对误差) / 不透明度
 *
 * 用法: node --max-old-space-size=8192 scripts/compare-quality.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGaussiansFromPly, loadGaussiansFromSplat } from '../packages/convert/dist/index.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SAMPLES = 2000;

function toArrayBuffer(buf) {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy.buffer;
}

function quatAngleDeg(w1, x1, y1, z1, w2, x2, y2, z2) {
  // 归一化后点积 → 角度
  const n1 = Math.hypot(w1, x1, y1, z1) || 1;
  const n2 = Math.hypot(w2, x2, y2, z2) || 1;
  const dot = Math.min(1, Math.abs((w1 * w2 + x1 * x2 + y1 * y2 + z1 * z2) / (n1 * n2)));
  return (2 * Math.acos(dot)) * 180 / Math.PI;
}

function compare(name, srcCloud, dstCloud) {
  const n = Math.min(srcCloud.splats.length, dstCloud.splats.length);
  if (srcCloud.splats.length !== dstCloud.splats.length) {
    console.log(`  ⚠️ splat 数不一致: 源 ${srcCloud.splats.length} vs 产物 ${dstCloud.splats.length}`);
  }
  const step = Math.max(1, Math.floor(n / SAMPLES));
  let posMax = 0, posSum = 0;
  let scaleRelMax = 0, scaleRelSum = 0;
  let rotMax = 0, rotSum = 0;
  let colorMax = 0, colorSum = 0;
  let opMax = 0, opSum = 0;
  let cnt = 0;

  for (let i = 0; i < n; i += step) {
    const a = srcCloud.splats[i];
    const b = dstCloud.splats[i];
    cnt++;

    const dp = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    posMax = Math.max(posMax, dp); posSum += dp;

    const sRef = Math.max(a.scaleX, a.scaleY, a.scaleZ, 1e-9);
    const ds = (Math.abs(a.scaleX - b.scaleX) + Math.abs(a.scaleY - b.scaleY) + Math.abs(a.scaleZ - b.scaleZ)) / 3 / sRef;
    scaleRelMax = Math.max(scaleRelMax, ds); scaleRelSum += ds;

    const dr = quatAngleDeg(a.rotW, a.rotX, a.rotY, a.rotZ, b.rotW, b.rotX, b.rotY, b.rotZ);
    rotMax = Math.max(rotMax, dr); rotSum += dr;

    const dc = (Math.abs(a.colorR - b.colorR) + Math.abs(a.colorG - b.colorG) + Math.abs(a.colorB - b.colorB)) / 3;
    colorMax = Math.max(colorMax, dc); colorSum += dc;

    const dop = Math.abs(a.opacity - b.opacity);
    opMax = Math.max(opMax, dop); opSum += dop;
  }

  console.log(`  采样 ${cnt} 个 splat:`);
  console.log(`    位置   平均 ${((posSum / cnt) * 1000).toFixed(3)}‰单位  最大 ${(posMax * 1000).toFixed(3)}‰单位`);
  console.log(`    缩放   平均相对误差 ${(100 * scaleRelSum / cnt).toFixed(4)}%  最大 ${(100 * scaleRelMax).toFixed(4)}%`);
  console.log(`    旋转   平均角度误差 ${(rotSum / cnt).toFixed(4)}°  最大 ${rotMax.toFixed(4)}°`);
  console.log(`    颜色   平均 ${((255 * colorSum / cnt)).toFixed(3)}/255  最大 ${(255 * colorMax).toFixed(3)}/255`);
  console.log(`    透明度 平均 ${((255 * opSum / cnt)).toFixed(3)}/255  最大 ${(255 * opMax).toFixed(3)}/255`);

  // 颜色/透明度分布统计 (判断是否有系统性偏移)
  let srcAvg = [0, 0, 0], dstAvg = [0, 0, 0];
  for (let i = 0; i < n; i += step) {
    srcAvg[0] += srcCloud.splats[i].colorR; srcAvg[1] += srcCloud.splats[i].colorG; srcAvg[2] += srcCloud.splats[i].colorB;
    dstAvg[0] += dstCloud.splats[i].colorR; dstAvg[1] += dstCloud.splats[i].colorG; dstAvg[2] += dstCloud.splats[i].colorB;
  }
  console.log(`    颜色均值 源(${(srcAvg[0] / cnt).toFixed(3)},${(srcAvg[1] / cnt).toFixed(3)},${(srcAvg[2] / cnt).toFixed(3)}) 产物(${(dstAvg[0] / cnt).toFixed(3)},${(dstAvg[1] / cnt).toFixed(3)},${(dstAvg[2] / cnt).toFixed(3)})`);
}

const CASES = [
  ['demo1', 'demo1.ply', 'demo1.splat'],
  ['demo2', 'demo2.ply', 'demo2.splat'],
  ['garden', 'garden.ply', 'garden.splat'],
];

for (const [name, src, dst] of CASES) {
  console.log(`\n=== ${name}: ${src} → ${dst} ===`);
  const t0 = Date.now();
  const srcCloud = loadGaussiansFromPly(toArrayBuffer(readFileSync(join(root, 'ply', src))), { source: src });
  console.log(`  源解析 ${(0.001 * (Date.now() - t0)).toFixed(1)}s, ${srcCloud.splats.length} splats, SH degree ${srcCloud.shDegree}`);

  const t1 = Date.now();
  const dstCloud = loadGaussiansFromSplat(toArrayBuffer(readFileSync(join(root, 'ply', 'output', dst))), { source: dst });
  console.log(`  产物解析 ${(0.001 * (Date.now() - t1)).toFixed(1)}s, ${dstCloud.splats.length} splats`);

  compare(name, srcCloud, dstCloud);
}
console.log('\n分析完成');
