/**
 * HotspotManager — 热点管理器
 *
 * v4.1: 从 @3dgs/core 迁移至 @3dgs/plugins
 * 负责:
 *   1. 热点 DOM 元素创建与销毁
 *   2. 3D 世界坐标 → 2D 屏幕坐标投影
 *   3. 距离/视角可见性过滤
 *   4. 点击/悬停事件路由
 */

import type { HotspotConfig } from './hotspot-config.js';

export interface HotspotInstance {
  config: HotspotConfig;
  el: HTMLDivElement;
  visible: boolean;
}

export interface HotspotUpdateData {
  camera: { x: number; y: number; z: number };
  vpMatrix: Float32Array;    // 16 元素 view-projection 矩阵
  width: number;
  height: number;
}

export type HotspotEventHandler = (instance: HotspotInstance) => void;

export class HotspotManager {
  private hotspots = new Map<string, HotspotInstance>();
  private container?: HTMLElement;
  private onClickHandler?: HotspotEventHandler;
  private onHoverHandler?: HotspotEventHandler;

  /** 设置容器（热点 DOM 将挂载于此） */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  /** 设置热点列表 */
  setHotspots(hotspots: HotspotConfig[]): void {
    this.clear();

    if (!this.container) {
      console.warn('HotspotManager: 容器未设置，热点不会渲染');
      return;
    }

    for (const config of hotspots) {
      const el = this.createHotspotElement(config);
      this.container.appendChild(el);
      this.hotspots.set(config.id, { config, el, visible: false });
    }
  }

  /** 清除所有热点 */
  clear(): void {
    for (const { el } of this.hotspots.values()) {
      el.remove();
    }
    this.hotspots.clear();
  }

  get(id: string): HotspotInstance | undefined {
    return this.hotspots.get(id);
  }

  list(): HotspotInstance[] {
    return Array.from(this.hotspots.values());
  }

  /** 注册点击回调 */
  onClick(handler: HotspotEventHandler): void {
    this.onClickHandler = handler;
  }

  /** 注册悬停回调 */
  onHover(handler: HotspotEventHandler): void {
    this.onHoverHandler = handler;
  }

  /**
   * 每帧更新: 投影热点位置到屏幕，更新可见性
   */
  updateVisibility(data: HotspotUpdateData): void {
    const { camera, vpMatrix, width, height } = data;

    for (const instance of this.hotspots.values()) {
      const { config, el } = instance;
      const [px, py, pz] = config.position;

      // ── 3D → Clip Space ──
      // VP 矩阵 (4x4, column-major) × position(x, y, z, 1)
      const clipX = vpMatrix[0] * px + vpMatrix[4] * py + vpMatrix[8]  * pz + vpMatrix[12];
      const clipY = vpMatrix[1] * px + vpMatrix[5] * py + vpMatrix[9]  * pz + vpMatrix[13];
      const clipZ = vpMatrix[2] * px + vpMatrix[6] * py + vpMatrix[10] * pz + vpMatrix[14];
      const clipW = vpMatrix[3] * px + vpMatrix[7] * py + vpMatrix[11] * pz + vpMatrix[15];

      // ── NDC ──
      if (clipW <= 0) {
        // 在相机后方或恰好在相机上
        this.setElementVisible(el, false);
        instance.visible = false;
        continue;
      }

      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      const ndcZ = clipZ / clipW;

      // ── 屏幕坐标 ──
      const screenX = (ndcX * 0.5 + 0.5) * width;
      const screenY = (1.0 - (ndcY * 0.5 + 0.5)) * height;

      // ── 距离过滤 ──
      const dx = px - camera.x;
      const dy = py - camera.y;
      const dz = pz - camera.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const vis = config.visibility;
      const minDistOk = !vis?.minDistance || distance >= vis.minDistance;
      const maxDistOk = !vis?.maxDistance || distance <= vis.maxDistance;
      const inFrustum = ndcZ >= -1 && ndcZ <= 1 && ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1;

      const visible = minDistOk && maxDistOk && inFrustum;
      instance.visible = visible;

      if (visible) {
        el.style.display = 'flex';
        el.style.left = `${screenX}px`;
        el.style.top = `${screenY}px`;

        // 距离衰减
        const opacity = vis?.maxDistance
          ? Math.max(0.3, 1 - distance / vis.maxDistance)
          : 1;
        el.style.opacity = String(opacity);
      } else {
        el.style.display = 'none';
      }
    }
  }

  // ─── 内部方法 ────────────────────────────────────────────

  private createHotspotElement(config: HotspotConfig): HTMLDivElement {
    const el = document.createElement('div');
    el.className = '3dgs-hotspot';
    el.dataset.hotspotId = config.id;
    el.dataset.hotspotType = config.type;
    el.dataset.hotspot = 'true';
    el.dataset.worldPos = config.position.join(',');

    const style: Partial<CSSStyleDeclaration> = {
      position: 'absolute',
      display: 'none',
      pointerEvents: 'auto',
      cursor: 'pointer',
      userSelect: 'none',
      transform: 'translate(-50%, -50%)',
      zIndex: '10',
      transition: 'opacity 0.2s ease',
    };

    const customStyle = config.style;
    const size = customStyle?.size ?? 32;
    const color = customStyle?.color ?? '#ffffff';
    const opacity = customStyle?.opacity ?? 1;

    Object.assign(el.style, style);

    // 内容渲染
    if (config.type === 'text') {
      el.style.background = 'rgba(0,0,0,0.7)';
      el.style.color = color;
      el.style.padding = '4px 10px';
      el.style.borderRadius = '6px';
      el.style.fontSize = '13px';
      el.style.whiteSpace = 'nowrap';
      el.textContent = config.onHover?.tooltip || config.id;
    } else if (config.type === 'scene') {
      // 场景跳转热点: 圆形带发光
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = '50%';
      el.style.background = 'rgba(255,255,255,0.15)';
      el.style.border = `2px solid ${color}`;
      el.style.boxShadow = customStyle?.glow ? `0 0 12px ${color}` : 'none';
      el.style.opacity = String(opacity);

      if (customStyle?.pulse) {
        el.style.animation = '3dgs-hotspot-pulse 2s ease-in-out infinite';
      }
    } else if (config.type === 'image') {
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = '50%';
      el.style.border = `2px solid ${color}`;
      if (customStyle?.icon) {
        el.style.backgroundImage = `url(${customStyle.icon})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      } else {
        el.style.background = 'rgba(255,255,255,0.2)';
      }
    } else {
      // custom / url
      el.style.background = 'rgba(0,0,0,0.6)';
      el.style.color = color;
      el.style.padding = '4px 10px';
      el.style.borderRadius = '6px';
      el.style.fontSize = '13px';
      el.textContent = config.id;
    }

    // 事件
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClickHandler?.(this.get(config.id)!);
    });
    el.addEventListener('mouseenter', () => {
      this.onHoverHandler?.(this.get(config.id)!);
    });

    return el;
  }

  private setElementVisible(el: HTMLDivElement, visible: boolean): void {
    el.style.display = visible ? 'flex' : 'none';
  }

  /** 注入 CSS 动画 keyframes（如果尚未注入） */
  static injectStyles(): void {
    if (document.getElementById('3dgs-hotspot-styles')) return;
    const style = document.createElement('style');
    style.id = '3dgs-hotspot-styles';
    style.textContent = `
      @keyframes 3dgs-hotspot-pulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); }
        50% { transform: translate(-50%, -50%) scale(1.3); }
      }
    `;
    document.head.appendChild(style);
  }

  destroy(): void {
    this.clear();
    this.onClickHandler = undefined;
    this.onHoverHandler = undefined;
    this.container = undefined;
  }
}
