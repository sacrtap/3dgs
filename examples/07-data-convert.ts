/**
 * 示例 7: 数据转换 — 使用 CLI 工具
 *
 * 运行方式:
 *   npx @3dgs/convert ply-to-splat input.ply --output output.splat
 *   npx @3dgs/convert ply-to-spz input.ply --output output.spz --sh-degree 1
 *   npx @3dgs/convert ply-to-sog input.ply --output output.sog --chunk-size 50000
 *   npx @3dgs/convert batch ./scenes/ --format spz --output ./dist/
 *   npx @3dgs/convert generate-tour ./scenes/ --output tour.json
 *   npx @3dgs/convert info input.ply
 */

// 编程式使用 (Node.js 环境)
import { convertPlyToSplat, convertPlyToSpz, convertPlyToSog } from '@3dgs/convert';

async function main() {
  // PLY → SPLAT
  await convertPlyToSplat('input.ply', 'output.splat');
  console.log('✓ SPLAT 转换完成');

  // PLY → SPZ (gzip 压缩, SH 1)
  await convertPlyToSpz('input.ply', 'output.spz', { shDegree: 1 });
  console.log('✓ SPZ 转换完成');

  // PLY → SOG v2 (流式 LOD + gzip 压缩 + 预构建 LOD 树)
  await convertPlyToSog('input.ply', 'output.sog', {
    chunkSize: 50000,
    compression: true,     // gzip 压缩 chunk 数据
    buildLodTree: true,   // 预构建 LOD 树 (Morton 前缀子集)
    positionQuant: false, // 位置量化 (true = 29 字节紧凑格式)
  });
  console.log('✓ SOG v2 转换完成');
}

main().catch(console.error);
