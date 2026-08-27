import { describe, it, expect } from 'vitest';
import { mergeSortedVisibleIndices } from './webgpu-render-manager.js';

/**
 * ★ D-01 单一索引管线合并逻辑测试
 *
 * 背景: 旧实现中 GPU 排序结果与视锥裁剪结果都写入同一个
 * `splatBuffers.index`, 后写者覆盖先写者, 导致排序与裁剪双双失效。
 * 修复后统一为: drawIndices = sortedIndices ∩ visibleMask, 仅写入一次。
 */
describe('mergeSortedVisibleIndices — D-01 单一索引管线', () => {
  it('排序 ∩ 可见: 结果 = 有序且可见 (核心修复断言)', () => {
    // 5 个 splat, 排序结果 (远→近): [3, 1, 4, 0, 2]
    const sorted = new Uint32Array([3, 1, 4, 0, 2]);
    // 可见位图: 0, 2, 3 可见; 1, 4 不可见
    const mask = new Uint8Array([1, 0, 1, 1, 0]);
    const out = new Uint32Array(5);

    const n = mergeSortedVisibleIndices(sorted, mask, 5, out, true);

    // 期望: 按排序顺序过滤出可见项 → [3, 0, 2]
    expect(n).toBe(3);
    expect(Array.from(out.subarray(0, n))).toEqual([3, 0, 2]);
  });

  it('保持 back-to-front 顺序 (排序顺序不被裁剪打乱)', () => {
    const sorted = new Uint32Array([9, 7, 5, 3, 1]);
    const mask = new Uint8Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    const out = new Uint32Array(5);

    const n = mergeSortedVisibleIndices(sorted, mask, 5, out, true);

    expect(n).toBe(5);
    // 顺序必须与排序结果一致 (9 最远先渲染)
    expect(Array.from(out.subarray(0, n))).toEqual([9, 7, 5, 3, 1]);
  });

  it('全部不可见时可见数为 0', () => {
    const sorted = new Uint32Array([0, 1, 2]);
    const mask = new Uint8Array([0, 0, 0]);
    const out = new Uint32Array(3);

    const n = mergeSortedVisibleIndices(sorted, mask, 3, out, true);

    expect(n).toBe(0);
  });

  it('首次排序完成前 (无排序结果): 按自然顺序过滤, 裁剪仍生效', () => {
    const mask = new Uint8Array([1, 1, 0, 1]);
    const out = new Uint32Array(4);

    const n = mergeSortedVisibleIndices(null, mask, 4, out, true);

    expect(n).toBe(3);
    expect(Array.from(out.subarray(0, n))).toEqual([0, 1, 3]);
  });

  it('裁剪关闭 + 有排序结果: 直接采用排序结果 (全量)', () => {
    const sorted = new Uint32Array([2, 0, 1]);
    const out = new Uint32Array(3);

    const n = mergeSortedVisibleIndices(sorted, null, 3, out, false);

    expect(n).toBe(3);
    expect(Array.from(out.subarray(0, n))).toEqual([2, 0, 1]);
  });

  it('裁剪关闭 + 无排序结果: 自然顺序全量', () => {
    const out = new Uint32Array(3);

    const n = mergeSortedVisibleIndices(null, null, 3, out, false);

    expect(n).toBe(3);
    expect(Array.from(out.subarray(0, n))).toEqual([0, 1, 2]);
  });

  it('交错序列 (排序→裁剪→排序): 每次输出始终 = 有序 ∩ 可见', () => {
    // 模拟旧缺陷场景: 排序与裁剪交替发生, 断言任一时刻合并结果都正确
    const mask = new Uint8Array([1, 0, 1, 1]);
    const out = new Uint32Array(4);

    // 第一次排序结果
    let sorted = new Uint32Array([3, 2, 1, 0]);
    let n = mergeSortedVisibleIndices(sorted, mask, 4, out, true);
    expect(Array.from(out.subarray(0, n))).toEqual([3, 2, 0]);

    // 裁剪更新 (掩码变化, 排序结果不变) — 不应丢失排序顺序
    mask.set([1, 1, 1, 0]);
    n = mergeSortedVisibleIndices(sorted, mask, 4, out, true);
    expect(Array.from(out.subarray(0, n))).toEqual([2, 1, 0]);

    // 新排序结果到达 — 不应被旧裁剪覆盖
    sorted = new Uint32Array([1, 2, 0, 3]);
    n = mergeSortedVisibleIndices(sorted, mask, 4, out, true);
    expect(Array.from(out.subarray(0, n))).toEqual([1, 2, 0]);
  });

  it('count=0: 返回 0', () => {
    const out = new Uint32Array(0);
    const n = mergeSortedVisibleIndices(null, null, 0, out, true);
    expect(n).toBe(0);
  });
});
