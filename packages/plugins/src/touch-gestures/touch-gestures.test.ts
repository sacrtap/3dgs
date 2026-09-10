import { describe, it, expect } from 'vitest';

/**
 * TouchGestures 插件的纯逻辑测试。
 *
 * getTouchDistance 和 getTouchAngle 是模块内部函数，无法直接导入。
 * 这里通过重现其数学定义来验证核心计算逻辑。
 */

function getTouchDistance(
  t1: { clientX: number; clientY: number },
  t2: { clientX: number; clientY: number },
): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchAngle(
  t1: { clientX: number; clientY: number },
  t2: { clientX: number; clientY: number },
): number {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
}

describe('TouchGestures — 触摸手势纯逻辑', () => {
  describe('getTouchDistance — 双指距离', () => {
    it('相同点距离为 0', () => {
      expect(getTouchDistance({ clientX: 100, clientY: 100 }, { clientX: 100, clientY: 100 })).toBe(
        0,
      );
    });

    it('水平距离 100px', () => {
      expect(
        getTouchDistance({ clientX: 0, clientY: 50 }, { clientX: 100, clientY: 50 }),
      ).toBeCloseTo(100, 5);
    });

    it('垂直距离 80px', () => {
      expect(
        getTouchDistance({ clientX: 50, clientY: 0 }, { clientX: 50, clientY: 80 }),
      ).toBeCloseTo(80, 5);
    });

    it('对角线距离 = sqrt(3² + 4²) = 5', () => {
      expect(getTouchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBeCloseTo(
        5,
        5,
      );
    });

    it('对称性: dist(A,B) = dist(B,A)', () => {
      const a = { clientX: 120, clientY: 340 };
      const b = { clientX: 560, clientY: 780 };
      expect(getTouchDistance(a, b)).toBeCloseTo(getTouchDistance(b, a), 10);
    });
  });

  describe('getTouchAngle — 双指角度', () => {
    it('水平右方向 = 0', () => {
      expect(getTouchAngle({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 })).toBeCloseTo(
        0,
        5,
      );
    });

    it('垂直下方向 = π/2', () => {
      expect(getTouchAngle({ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 })).toBeCloseTo(
        Math.PI / 2,
        5,
      );
    });

    it('水平左方向 = ±π', () => {
      expect(getTouchAngle({ clientX: 100, clientY: 0 }, { clientX: 0, clientY: 0 })).toBeCloseTo(
        Math.PI,
        5,
      );
    });

    it('45° 对角线 = π/4', () => {
      expect(getTouchAngle({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 100 })).toBeCloseTo(
        Math.PI / 4,
        5,
      );
    });
  });

  describe('捏合缩放 FOV 计算', () => {
    it('捏合放大 (距离增大) → FOV 减小', () => {
      const pinchSensitivity = 0.01;
      const initialFov = 75;
      const minFov = 30;
      const maxFov = 100;

      const initialDistance = 100;
      const currentDistance = 150; // 放大 1.5x
      const distanceRatio = currentDistance / initialDistance;
      const fovDelta = -(distanceRatio - 1) / pinchSensitivity;
      const currentFov = Math.max(minFov, Math.min(maxFov, initialFov + fovDelta));

      // fovDelta = -(1.5 - 1) / 0.01 = -50
      // currentFov = max(30, min(100, 75 + (-50))) = max(30, 25) = 30
      expect(currentFov).toBe(30);
    });

    it('捏合缩小 (距离减小) → FOV 增大', () => {
      const pinchSensitivity = 0.01;
      const initialFov = 75;
      const minFov = 30;
      const maxFov = 100;

      const initialDistance = 100;
      const currentDistance = 50; // 缩小 0.5x
      const distanceRatio = currentDistance / initialDistance;
      const fovDelta = -(distanceRatio - 1) / pinchSensitivity;
      const currentFov = Math.max(minFov, Math.min(maxFov, initialFov + fovDelta));

      // fovDelta = -(0.5 - 1) / 0.01 = 50
      // currentFov = max(30, min(100, 75 + 50)) = min(100, 125) = 100
      expect(currentFov).toBe(100);
    });

    it('FOV 被 clamp 在 [minFov, maxFov] 范围内', () => {
      const clamp = (fov: number, min: number, max: number) => Math.max(min, Math.min(max, fov));
      expect(clamp(10, 30, 100)).toBe(30);
      expect(clamp(150, 30, 100)).toBe(100);
      expect(clamp(60, 30, 100)).toBe(60);
    });
  });

  describe('惯性阻尼', () => {
    it('惯性速度按 damping 系数衰减', () => {
      const damping = 0.92;
      let yaw = 1.0;
      let pitch = 0.5;

      for (let i = 0; i < 50; i++) {
        yaw *= damping;
        pitch *= damping;
      }

      // 50 次迭代后: 1.0 * 0.92^50 ≈ 0.015, 0.5 * 0.92^50 ≈ 0.008
      expect(Math.abs(yaw)).toBeLessThan(0.02);
      expect(Math.abs(pitch)).toBeLessThan(0.01);
    });

    it('停止条件: 速度 < 0.001 时停止', () => {
      const damping = 0.92;
      let yaw = 0.5;
      let iterations = 0;

      while (Math.abs(yaw) >= 0.001) {
        yaw *= damping;
        iterations++;
      }

      // 0.5 * 0.92^n < 0.001 → n > ln(0.002)/ln(0.92) ≈ 65
      expect(iterations).toBeGreaterThan(60);
      expect(iterations).toBeLessThan(80);
    });
  });
});
