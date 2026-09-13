/**
 * ★ M2衍: SPLAT_RENDER_SHADER 内容回归测试 — SH DC 项不再重复乘 SH_C0
 *
 * 背景 (OCR high 修复): 原实现 `outR = SH_C0 * dcR + Σ...` 把 DC 颜色
 * (colors 流已含 SH_C0*f_dc+0.5 归一) 再次乘 SH_C0, 导致整体颜色偏暗。
 * 修复后: `outR = dcR + Σ shCoeffs × 基函数`。
 *
 * 用字符串断言生成产物, 无需 GPU 环境。
 */
import { describe, it, expect } from 'vitest';
import { SPLAT_RENDER_SHADER } from './splat-render-shader.js';

describe('SPLAT_RENDER_SHADER — SH DC 归一', () => {
  const shader = SPLAT_RENDER_SHADER('rgba8unorm');

  it('★ DC 项直接使用 colors 流值, 不重复乘 SH_C0', () => {
    // 修复前: var outR = SH_C0 * dcR (二次归一) — 回归锚点
    expect(shader).toContain('var outR = dcR');
    expect(shader).toContain('var outG = dcG');
    expect(shader).toContain('var outB = dcB');
    expect(shader).not.toContain('SH_C0 * dcR');
    expect(shader).not.toContain('SH_C0 * dcG');
    expect(shader).not.toContain('SH_C0 * dcB');
  });

  it('★ SH 非 DC 项直接加系数×基函数 (SH_C0 只用于 DC 存储归一, 不再参与组合)', () => {
    // 修复后 SH 项: shCoeffs[base] * l1y 等 — 无额外 SH_C0 因子
    expect(shader).toContain('outR = dcR + shCoeffs[base] * l1y');
    // SH_C0 常量仍存在 (DC 存储时用于归一, 保持语义文档)
    expect(shader).toContain('const SH_C0 = 0.28209479177387814');
  });

  it('★ L3 (degree-3, shDim=15) 系数被完整求值 — 与 Spark evaluatePackedSH 基函数一致', () => {
    // 回归锚点: shader 曾只求值到 L2, degree-3 数据上传 45 系数却只用 24 个 (静默降级)
    expect(shader).toContain('if (shDim >= 15u)');
    // 7 个 L3 基函数 (Spark 权威常量)
    expect(shader).toContain('-0.5900436 * y * (3.0 * x * x - y * y)'); // sh3_0
    expect(shader).toContain('2.8906114 * x * y * z'); // sh3_1
    expect(shader).toContain('-0.4570458 * y * (4.0 * z * z - x * x - y * y)'); // sh3_2
    expect(shader).toContain('0.3731763 * z * (2.0 * z * z - 3.0 * x * x - 3.0 * y * y)'); // sh3_3
    expect(shader).toContain('1.4453057 * z * (x * x - y * y)'); // sh3_5
    expect(shader).toContain('-0.5900436 * x * (x * x - 3.0 * y * y)'); // sh3_6
    // 每 splat 45 系数 (shDim=15) 全部被索引
    expect(shader).toContain('shCoeffs[base + 42u]');
    expect(shader).toContain('shCoeffs[base + 44u]');
  });
});
