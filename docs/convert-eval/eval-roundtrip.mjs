/**
 * convert-eval: 四格式 round-trip 量化误差对比脚本 v2 (一次性评估工具)
 *
 * 对比策略:
 *   - SOG 默认 Morton 排序 → 按位置最近邻将产物 splat 映射回源索引再对比
 *   - SPZ/压缩 PLY 旋转布局与源不同 ([x,y,z,w] + w≥0 / smallest-three) →
 *     旋转按四元数等价性 (q 与 -q 视为相同) 度量最小分量差
 *   - 其余属性按对齐后索引直接对比
 * 输出 JSON 到 docs/convert-eval/artifacts/metrics.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGaussiansFromPlySoA } from '../src/gaussian-loader.js';
import { loadGaussiansFromSplatSoA } from '../src/splat-reader.js';
import { loadGaussiansFromSpzSoA } from '../src/spz-reader.js';
import { loadGaussiansFromSogSoA } from '../src/sog-reader.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const srcDir = '/Users/sacrtap/Documents/project_work/3dgs/ply';
const artDir = join(root, 'docs', 'convert-eval', 'artifacts');

const files = ['demo1', 'demo2', 'garden'];

function toAB(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** 位置最近邻映射 (粗网格哈希, O(N)): 返回 源索引 → 产物索引 */
function mapByPosition(srcPos, dstPos, count) {
  // 网格大小基于 bbox 量级自适应: 用源位置中位数跨度粗分
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const x = srcPos[i3], y = srcPos[i3 + 1], z = srcPos[i3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cell = 0.001 * Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6) + 1e-9;
  const bucket = new Map();
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const key = `${Math.floor(dstPos[i3] / cell)},${Math.floor(dstPos[i3 + 1] / cell)},${Math.floor(dstPos[i3 + 2] / cell)}`;
    bucket.set(key, i);
  }
  const map = new Uint32Array(count);
  let matched = 0;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const key = `${Math.floor(srcPos[i3] / cell)},${Math.floor(srcPos[i3 + 1] / cell)},${Math.floor(srcPos[i3 + 2] / cell)}`;
    const j = bucket.get(key);
    if (j !== undefined) { map[i] = j; matched++; } else { map[i] = i; }
  }
  return { map, matched };
}

/** 属性数组按映射对齐: srcAr[i] vs dstAr[map[i]] */
function compareAligned(a, b, map, count, label) {
  const n = count;
  let maxErr = 0;
  let sumSq = 0;
  const na = a.length / count;
  for (let i = 0; i < n; i++) {
    const dst = map[i];
    for (let k = 0; k < na; k++) {
      const d = Math.abs(a[i * na + k] - b[dst * na + k]);
      if (d > maxErr) maxErr = d;
      sumSq += d * d;
    }
  }
  return { maxErr, rmsErr: Math.sqrt(sumSq / (n * na)) };
}

/** 四元数等价距离: 取 q 与 -q 的最小分量差 */
function compareQuatAligned(a, b, map, count, label) {
  let maxErr = 0;
  let sumSq = 0;
  for (let i = 0; i < count; i++) {
    const dst = map[i];
    const i4 = i * 4;
    const j4 = dst * 4;
    let d1 = 0, d2 = 0;
    for (let k = 0; k < 4; k++) {
      d1 += Math.abs(a[i4 + k] - b[j4 + k]);
      d2 += Math.abs(a[i4 + k] + b[j4 + k]); // -q
    }
    const d = Math.min(d1, d2);
    if (d > maxErr) maxErr = d;
    sumSq += d * d;
  }
  return { maxErr, rmsErr: Math.sqrt(sumSq / count) };
}

const results = {};

for (const f of files) {
  const srcBuf = readFileSync(join(srcDir, `${f}.ply`));
  const src = loadGaussiansFromPlySoA(toAB(srcBuf), { source: f });
  const count = src.count;
  results[f] = {
    source: { count, shDegree: src.shDegree, shLength: src.sh?.length ?? 0 },
    formats: {},
  };

  // SPLAT (无损位置, 顺序与源一致 → 直接索引对比)
  const splatBuf = readFileSync(join(artDir, `${f}.splat`));
  const splat = loadGaussiansFromSplatSoA(toAB(splatBuf));
  const idMap = new Uint32Array(count);
  for (let i = 0; i < count; i++) idMap[i] = i;
  results[f].formats.splat = {
    count: splat.count,
    shDegree: splat.shDegree,
    aligned: 'index',
    positions: compareAligned(splat.positions, src.positions, idMap, count, 'pos'),
    scales: compareAligned(splat.scales, src.scales, idMap, count, 'scale'),
    rotations: compareQuatAligned(src.rotations, splat.rotations, idMap, count, 'rot'),
    colors: compareAligned(splat.colors, src.colors, idMap, count, 'color'),
    opacities: compareAligned(splat.opacities, src.opacities, idMap, count, 'op'),
  };

  // SPZ
  const spzBuf = readFileSync(join(artDir, `${f}.spz`));
  const spz = await loadGaussiansFromSpzSoA(new Uint8Array(toAB(spzBuf)));
  results[f].formats.spz = {
    count: spz.count,
    shDegree: spz.shDegree,
    aligned: 'index',
    positions: compareAligned(spz.positions, src.positions, idMap, count, 'pos'),
    scales: compareAligned(spz.scales, src.scales, idMap, count, 'scale'),
    rotations: compareQuatAligned(src.rotations, spz.rotations, idMap, count, 'rot'),
    colors: compareAligned(spz.colors, src.colors, idMap, count, 'color'),
    opacities: compareAligned(spz.opacities, src.opacities, idMap, count, 'op'),
  };

  // SOG (no-sort 产物: 顺序保留 → 索引对比)
  const sogBuf = readFileSync(join(artDir, `${f}.sog`));
  const sog = loadGaussiansFromSogSoA(toAB(sogBuf));
  results[f].formats.sog = {
    count: sog.count,
    shDegree: sog.shDegree,
    aligned: 'index',
    positions: compareAligned(sog.positions, src.positions, idMap, count, 'pos'),
    scales: compareAligned(sog.scales, src.scales, idMap, count, 'scale'),
    rotations: compareQuatAligned(src.rotations, sog.rotations, idMap, count, 'rot'),
    colors: compareAligned(sog.colors, src.colors, idMap, count, 'color'),
    opacities: compareAligned(sog.opacities, src.opacities, idMap, count, 'op'),
  };

  // 压缩 PLY
  const cplyBuf = readFileSync(join(artDir, `${f}.compressed.ply`));
  const cply = loadGaussiansFromPlySoA(toAB(cplyBuf));
  results[f].formats.compressedPly = {
    count: cply.count,
    shDegree: cply.shDegree,
    aligned: 'index',
    positions: compareAligned(cply.positions, src.positions, idMap, count, 'pos'),
    scales: compareAligned(cply.scales, src.scales, idMap, count, 'scale'),
    rotations: compareQuatAligned(src.rotations, cply.rotations, idMap, count, 'rot'),
    colors: compareAligned(cply.colors, src.colors, idMap, count, 'color'),
    opacities: compareAligned(cply.opacities, src.opacities, idMap, count, 'op'),
  };
}

writeFileSync(join(artDir, 'metrics.json'), JSON.stringify(results, null, 2));
console.log('metrics.json written');
for (const f of files) {
  console.log(`\n=== ${f} (count=${results[f].source.count}, shDegree=${results[f].source.shDegree}) ===`);
  for (const [fmt, m] of Object.entries(results[f].formats)) {
    console.log(
      `  ${fmt.padEnd(14)} pos=${m.positions.maxErr.toExponential(2)} scale=${m.scales.maxErr.toExponential(2)} rot=${m.rotations.maxErr.toExponential(2)} color=${m.colors.maxErr.toExponential(2)} op=${m.opacities.maxErr.toExponential(2)}`,
    );
  }
}