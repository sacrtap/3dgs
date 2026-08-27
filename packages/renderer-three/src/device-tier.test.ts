import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeviceTier } from '@3dgs/core';
import { getTierSettings, detectDeviceTier } from './device-tier.js';

describe('getTierSettings — P0 新增字段验证', () => {
  // 所有设备分级
  const tiers = [
    { tier: DeviceTier.LOW, name: 'LOW' },
    { tier: DeviceTier.MEDIUM, name: 'MEDIUM' },
    { tier: DeviceTier.HIGH, name: 'HIGH' },
    { tier: DeviceTier.ULTRA, name: 'ULTRA' },
  ];

  for (const { tier, name } of tiers) {
    describe(`${name} 分级`, () => {
      it('包含 minSortIntervalMs 字段且为正数', () => {
        const settings = getTierSettings(tier);
        expect(settings.minSortIntervalMs).toBeDefined();
        expect(typeof settings.minSortIntervalMs).toBe('number');
        expect(settings.minSortIntervalMs).toBeGreaterThan(0);
      });

      it('包含 coneFov0 字段且在 0-180 范围内', () => {
        const settings = getTierSettings(tier);
        expect(settings.coneFov0).toBeDefined();
        expect(settings.coneFov0).toBeGreaterThanOrEqual(0);
        expect(settings.coneFov0).toBeLessThanOrEqual(180);
      });

      it('包含 coneFov 字段且 >= coneFov0', () => {
        const settings = getTierSettings(tier);
        expect(settings.coneFov).toBeDefined();
        expect(settings.coneFov).toBeGreaterThanOrEqual(settings.coneFov0);
      });

      it('包含 coneFoveate 字段且在 0-1 范围内', () => {
        const settings = getTierSettings(tier);
        expect(settings.coneFoveate).toBeDefined();
        expect(settings.coneFoveate).toBeGreaterThan(0);
        expect(settings.coneFoveate).toBeLessThanOrEqual(1);
      });

      it('包含 behindFoveate 字段且在 0-1 范围内', () => {
        const settings = getTierSettings(tier);
        expect(settings.behindFoveate).toBeDefined();
        expect(settings.behindFoveate).toBeGreaterThan(0);
        expect(settings.behindFoveate).toBeLessThanOrEqual(1);
      });

      it('behindFoveate <= coneFoveate (背后分辨率不会高于边缘)', () => {
        const settings = getTierSettings(tier);
        expect(settings.behindFoveate).toBeLessThanOrEqual(settings.coneFoveate);
      });
    });
  }

  it('★ minSortIntervalMs 随设备分级提升而递减 (高端设备排序更频繁)', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const medium = getTierSettings(DeviceTier.MEDIUM);
    const high = getTierSettings(DeviceTier.HIGH);
    const ultra = getTierSettings(DeviceTier.ULTRA);

    expect(low.minSortIntervalMs).toBeGreaterThan(medium.minSortIntervalMs);
    expect(medium.minSortIntervalMs).toBeGreaterThan(high.minSortIntervalMs);
    expect(high.minSortIntervalMs).toBeGreaterThan(ultra.minSortIntervalMs);
  });

  it('★ coneFov0 随设备分级提升而递增 (高端设备中心全分辨率区域更大)', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const medium = getTierSettings(DeviceTier.MEDIUM);
    const high = getTierSettings(DeviceTier.HIGH);
    const ultra = getTierSettings(DeviceTier.ULTRA);

    expect(low.coneFov0).toBeLessThanOrEqual(medium.coneFov0);
    expect(medium.coneFov0).toBeLessThanOrEqual(high.coneFov0);
    expect(high.coneFov0).toBeLessThanOrEqual(ultra.coneFov0);
  });

  it('所有原有字段仍然存在', () => {
    for (const { tier } of tiers) {
      const settings = getTierSettings(tier);
      expect(settings).toHaveProperty('pixelRatio');
      expect(settings).toHaveProperty('resolutionScale');
      expect(settings).toHaveProperty('shDegree');
      expect(settings).toHaveProperty('maxSplats');
      expect(settings).toHaveProperty('antialias');
      expect(settings).toHaveProperty('lodSplatScale');
      expect(settings).toHaveProperty('lodRenderScale');
      expect(settings).toHaveProperty('maxStdDev');
      expect(settings).toHaveProperty('minPixelRadius');
      expect(settings).toHaveProperty('clipXY');
      expect(settings).toHaveProperty('lodQuality');
    }
  });

  it('ULTRA minSortIntervalMs = 16 (60fps 排序)', () => {
    const settings = getTierSettings(DeviceTier.ULTRA);
    expect(settings.minSortIntervalMs).toBe(16);
  });

  it('LOW minSortIntervalMs = 100 (约 10fps 排序)', () => {
    const settings = getTierSettings(DeviceTier.LOW);
    expect(settings.minSortIntervalMs).toBe(100);
  });
});

describe('getTierSettings — P1-1 PagedSplats 字段验证', () => {
  const tiers = [
    { tier: DeviceTier.LOW, name: 'LOW' },
    { tier: DeviceTier.MEDIUM, name: 'MEDIUM' },
    { tier: DeviceTier.HIGH, name: 'HIGH' },
    { tier: DeviceTier.ULTRA, name: 'ULTRA' },
  ];

  for (const { tier, name } of tiers) {
    describe(`${name} 分级`, () => {
      it('★ 包含 maxPagedSplats 字段且为正数', () => {
        const settings = getTierSettings(tier);
        expect(settings.maxPagedSplats).toBeDefined();
        expect(typeof settings.maxPagedSplats).toBe('number');
        expect(settings.maxPagedSplats).toBeGreaterThan(0);
      });

      it('★ maxPagedSplats 是 65536 的倍数 (页面大小对齐)', () => {
        const settings = getTierSettings(tier);
        expect(settings.maxPagedSplats % 65536).toBe(0);
      });

      it('★ 包含 numLodFetchers 字段且在 1-4 范围内', () => {
        const settings = getTierSettings(tier);
        expect(settings.numLodFetchers).toBeDefined();
        expect(typeof settings.numLodFetchers).toBe('number');
        expect(settings.numLodFetchers).toBeGreaterThanOrEqual(1);
        expect(settings.numLodFetchers).toBeLessThanOrEqual(4);
      });
    });
  }

  it('★ maxPagedSplats 随设备分级提升而递增', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const medium = getTierSettings(DeviceTier.MEDIUM);
    const high = getTierSettings(DeviceTier.HIGH);
    const ultra = getTierSettings(DeviceTier.ULTRA);

    expect(low.maxPagedSplats).toBeLessThan(medium.maxPagedSplats);
    expect(medium.maxPagedSplats).toBeLessThan(high.maxPagedSplats);
    expect(high.maxPagedSplats).toBeLessThan(ultra.maxPagedSplats);
  });

  it('★ numLodFetchers 随设备分级提升而递增或持平', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const ultra = getTierSettings(DeviceTier.ULTRA);

    expect(low.numLodFetchers).toBeLessThanOrEqual(ultra.numLodFetchers);
  });

  it('★ LOW maxPagedSplats = 4194304 (64 pages)', () => {
    const settings = getTierSettings(DeviceTier.LOW);
    expect(settings.maxPagedSplats).toBe(4_194_304);
  });

  it('★ ULTRA maxPagedSplats = 16777216 (256 pages)', () => {
    const settings = getTierSettings(DeviceTier.ULTRA);
    expect(settings.maxPagedSplats).toBe(16_777_216);
  });

  it('★ ULTRA numLodFetchers = 4', () => {
    const settings = getTierSettings(DeviceTier.ULTRA);
    expect(settings.numLodFetchers).toBe(4);
  });

  it('★ LOW numLodFetchers = 2', () => {
    const settings = getTierSettings(DeviceTier.LOW);
    expect(settings.numLodFetchers).toBe(2);
  });
});

describe('getTierSettings — L1 blurAmount 验证', () => {
  // 所有设备分级
  const tiers = [
    { tier: DeviceTier.LOW, name: 'LOW' },
    { tier: DeviceTier.MEDIUM, name: 'MEDIUM' },
    { tier: DeviceTier.HIGH, name: 'HIGH' },
    { tier: DeviceTier.ULTRA, name: 'ULTRA' },
  ];

  for (const { tier, name } of tiers) {
    describe(`${name} 分级`, () => {
      it('包含 blurAmount 字段且为非负数', () => {
        const settings = getTierSettings(tier);
        expect(settings.blurAmount).toBeDefined();
        expect(typeof settings.blurAmount).toBe('number');
        expect(settings.blurAmount).toBeGreaterThanOrEqual(0);
      });
    });
  }

  it('★ LOW blurAmount = 0.1 (减少 overdraw)', () => {
    const settings = getTierSettings(DeviceTier.LOW);
    expect(settings.blurAmount).toBe(0.1);
  });

  it('★ MEDIUM blurAmount = 0.2 (平衡)', () => {
    const settings = getTierSettings(DeviceTier.MEDIUM);
    expect(settings.blurAmount).toBe(0.2);
  });

  it('★ HIGH blurAmount = 0.3 (Spark 默认)', () => {
    const settings = getTierSettings(DeviceTier.HIGH);
    expect(settings.blurAmount).toBe(0.3);
  });

  it('★ ULTRA blurAmount = 0.3 (Spark 默认)', () => {
    const settings = getTierSettings(DeviceTier.ULTRA);
    expect(settings.blurAmount).toBe(0.3);
  });

  it('★ blurAmount 随设备分级提升而递增或持平', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const medium = getTierSettings(DeviceTier.MEDIUM);
    const high = getTierSettings(DeviceTier.HIGH);

    expect(low.blurAmount).toBeLessThanOrEqual(medium.blurAmount);
    expect(medium.blurAmount).toBeLessThanOrEqual(high.blurAmount);
  });
});

describe('getTierSettings — L1 衡生 minAlpha 验证', () => {
  const tiers = [
    { tier: DeviceTier.LOW, name: 'LOW' },
    { tier: DeviceTier.MEDIUM, name: 'MEDIUM' },
    { tier: DeviceTier.HIGH, name: 'HIGH' },
    { tier: DeviceTier.ULTRA, name: 'ULTRA' },
  ];

  for (const { tier, name } of tiers) {
    describe(`${name} 分级`, () => {
      it('包含 minAlpha 字段且为正数', () => {
        const settings = getTierSettings(tier);
        expect(settings.minAlpha).toBeDefined();
        expect(typeof settings.minAlpha).toBe('number');
        expect(settings.minAlpha).toBeGreaterThan(0);
      });
    });
  }

  it('★ LOW minAlpha = 5/255 (激进裁剪透明 splat)', () => {
    const settings = getTierSettings(DeviceTier.LOW);
    expect(settings.minAlpha).toBeCloseTo(5 / 255, 6);
  });

  it('★ MEDIUM minAlpha = 2/255 (中等裁剪)', () => {
    const settings = getTierSettings(DeviceTier.MEDIUM);
    expect(settings.minAlpha).toBeCloseTo(2 / 255, 6);
  });

  it('★ HIGH minAlpha = 1/255 (轻微裁剪, 质量优先)', () => {
    const settings = getTierSettings(DeviceTier.HIGH);
    expect(settings.minAlpha).toBeCloseTo(1 / 255, 6);
  });

  it('★ ULTRA minAlpha = 0.5/255 (Spark 默认, 几乎不裁剪)', () => {
    const settings = getTierSettings(DeviceTier.ULTRA);
    expect(settings.minAlpha).toBeCloseTo(0.5 / 255, 6);
  });

  it('★ minAlpha 随设备分级提升而递减 (高端设备裁剪更少, 质量更高)', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const medium = getTierSettings(DeviceTier.MEDIUM);
    const high = getTierSettings(DeviceTier.HIGH);
    const ultra = getTierSettings(DeviceTier.ULTRA);

    expect(low.minAlpha).toBeGreaterThan(medium.minAlpha);
    expect(medium.minAlpha).toBeGreaterThan(high.minAlpha);
    expect(high.minAlpha).toBeGreaterThan(ultra.minAlpha);
  });
});

describe('getTierSettings — L1 衡生 focalAdjustment 验证', () => {
  const tiers = [
    { tier: DeviceTier.LOW, name: 'LOW' },
    { tier: DeviceTier.MEDIUM, name: 'MEDIUM' },
    { tier: DeviceTier.HIGH, name: 'HIGH' },
    { tier: DeviceTier.ULTRA, name: 'ULTRA' },
  ];

  for (const { tier, name } of tiers) {
    describe(`${name} 分级`, () => {
      it('包含 focalAdjustment 字段且为正数', () => {
        const settings = getTierSettings(tier);
        expect(settings.focalAdjustment).toBeDefined();
        expect(typeof settings.focalAdjustment).toBe('number');
        expect(settings.focalAdjustment).toBeGreaterThan(0);
      });
    });
  }

  it('★ LOW focalAdjustment = 1.0 (Spark 默认, 不锐化)', () => {
    const settings = getTierSettings(DeviceTier.LOW);
    expect(settings.focalAdjustment).toBe(1.0);
  });

  it('★ MEDIUM focalAdjustment = 1.0 (Spark 默认)', () => {
    const settings = getTierSettings(DeviceTier.MEDIUM);
    expect(settings.focalAdjustment).toBe(1.0);
  });

  it('★ HIGH focalAdjustment = 1.5 (中等锐化)', () => {
    const settings = getTierSettings(DeviceTier.HIGH);
    expect(settings.focalAdjustment).toBe(1.5);
  });

  it('★ ULTRA focalAdjustment = 2.0 (匹配 PlayCanvas, 最锐利)', () => {
    const settings = getTierSettings(DeviceTier.ULTRA);
    expect(settings.focalAdjustment).toBe(2.0);
  });

  it('★ focalAdjustment 随设备分级提升而递增或持平 (高端设备更锐利)', () => {
    const low = getTierSettings(DeviceTier.LOW);
    const medium = getTierSettings(DeviceTier.MEDIUM);
    const high = getTierSettings(DeviceTier.HIGH);
    const ultra = getTierSettings(DeviceTier.ULTRA);

    expect(low.focalAdjustment).toBeLessThanOrEqual(medium.focalAdjustment);
    expect(medium.focalAdjustment).toBeLessThanOrEqual(high.focalAdjustment);
    expect(high.focalAdjustment).toBeLessThanOrEqual(ultra.focalAdjustment);
  });
});

// ── ★ N-03: iPadOS 检测 / ★ N-02: 高分屏 pixelRatio 适配 ──

describe('detectDeviceTier — N-03 iPadOS 移动设备识别', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNavigator(ua: string, opts?: { maxTouchPoints?: number; cores?: number; memory?: number }) {
    vi.stubGlobal('navigator', {
      userAgent: ua,
      hardwareConcurrency: opts?.cores ?? 8,
      deviceMemory: opts?.memory ?? 8,
      maxTouchPoints: opts?.maxTouchPoints ?? 0,
    });
  }

  it('iPadOS Safari (UA=Macintosh + 多触点) 识别为移动设备', () => {
    // iPadOS 13+ Safari UA 与 macOS 相同, 仅靠 UA 会误判为桌面端 → 分到高档导致卡顿
    stubNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      { maxTouchPoints: 5 },
    );
    const profile = detectDeviceTier();
    expect(profile.isMobile).toBe(true);
  });

  it('真桌面 Mac (无多触点) 不误判为移动设备', () => {
    stubNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      { maxTouchPoints: 0 },
    );
    const profile = detectDeviceTier();
    expect(profile.isMobile).toBe(false);
  });

  it('iPhone UA 仍识别为移动设备 (回归)', () => {
    stubNavigator(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      { maxTouchPoints: 5, cores: 6, memory: 4 },
    );
    const profile = detectDeviceTier();
    expect(profile.isMobile).toBe(true);
  });

  it('Android UA 仍识别为移动设备 (回归)', () => {
    stubNavigator(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
      { maxTouchPoints: 10 },
    );
    const profile = detectDeviceTier();
    expect(profile.isMobile).toBe(true);
  });

  it('iPad 被分到移动档 (LOW/MEDIUM) 而非桌面高档', () => {
    stubNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      { maxTouchPoints: 5, cores: 8, memory: 8 },
    );
    const profile = detectDeviceTier();
    // 移动设备最高只到 MEDIUM — 避免桌面 HIGH/ULTRA 参数压垮平板
    expect([DeviceTier.LOW, DeviceTier.MEDIUM]).toContain(profile.tier);
  });
});

describe('getTierSettings — N-02 高分屏 pixelRatio 适配', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无 window (Node/CI): 全部档位回退 1.0', () => {
    for (const tier of [DeviceTier.LOW, DeviceTier.MEDIUM, DeviceTier.HIGH, DeviceTier.ULTRA]) {
      expect(getTierSettings(tier).pixelRatio).toBe(1.0);
    }
  });

  it('dpr=2 时 HIGH/ULTRA 档有限跟随 (封顶 1.25 / 1.5), LOW/MEDIUM 保持 1.0', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });

    expect(getTierSettings(DeviceTier.LOW).pixelRatio).toBe(1.0);
    expect(getTierSettings(DeviceTier.MEDIUM).pixelRatio).toBe(1.0);
    // 性能优先: 封顶而非完全跟随 (dpr=2 时像素量 4x, 不可无限制)
    expect(getTierSettings(DeviceTier.HIGH).pixelRatio).toBe(1.25);
    expect(getTierSettings(DeviceTier.ULTRA).pixelRatio).toBe(1.5);
  });

  it('dpr=1 (普通屏): 各档均为 1.0, 无额外像素负担', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });

    for (const tier of [DeviceTier.LOW, DeviceTier.MEDIUM, DeviceTier.HIGH, DeviceTier.ULTRA]) {
      expect(getTierSettings(tier).pixelRatio).toBe(1.0);
    }
  });

  it('dpr=3 旗舰手机: 封顶生效 (不超过 1.25 / 1.5)', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });

    expect(getTierSettings(DeviceTier.HIGH).pixelRatio).toBeLessThanOrEqual(1.25);
    expect(getTierSettings(DeviceTier.ULTRA).pixelRatio).toBeLessThanOrEqual(1.5);
  });
});
