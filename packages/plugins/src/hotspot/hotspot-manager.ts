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
  /** ★ 最近一次投影的屏幕坐标 (弹出面板跟随用) */
  screenPos?: { x: number; y: number };
}

export interface HotspotUpdateData {
  camera: { x: number; y: number; z: number };
  vpMatrix: Float32Array;    // 16 元素 view-projection 矩阵
  width: number;
  height: number;
}

export type HotspotEventHandler = (instance: HotspotInstance) => void;

/** 弹出面板打开/关闭回调 */
export type HotspotPopupHandler = (instance: HotspotInstance | null) => void;

export class HotspotManager {
  private hotspots = new Map<string, HotspotInstance>();
  private container?: HTMLElement;
  private onClickHandler?: HotspotEventHandler;
  private onHoverHandler?: HotspotEventHandler;
  // ★ 点击弹出面板状态
  private popupOverlay?: HTMLDivElement;
  private popupPanel?: HTMLDivElement;
  private openPopupId?: string;
  private popupScreen: { x: number; y: number } | null = null;
  private onPopupOpenHandler?: HotspotPopupHandler;
  private onPopupCloseHandler?: HotspotPopupHandler;

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
    this.closePopup();
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

  /** ★ 注册弹出面板打开回调 */
  onPopupOpen(handler: HotspotPopupHandler): void {
    this.onPopupOpenHandler = handler;
  }

  /** ★ 注册弹出面板关闭回调 */
  onPopupClose(handler: HotspotPopupHandler): void {
    this.onPopupCloseHandler = handler;
  }

  /** ★ 当前打开的弹出面板对应热点 id */
  getOpenPopupId(): string | undefined {
    return this.openPopupId;
  }

  /**
   * ★ 打开热点弹出面板 (点击弹出交互)
   *
   * 屏幕空间面板: 遮罩 + 标题/内容/图片, 默认跟随热点位置并防越界。
   */
  openPopup(id: string): boolean {
    const instance = this.hotspots.get(id);
    if (!instance || !instance.config.popup || !this.container) return false;

    this.closePopup();

    const popup = instance.config.popup;
    const width = popup.width ?? 280;
    const dismissible = popup.dismissible !== false;

    // 遮罩层 (拦截场景交互, 可点击关闭)
    const overlay = document.createElement('div');
    overlay.className = '3dgs-popup-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0', left: '0',
      width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.25)',
      display: 'flex',
      zIndex: '100',
      cursor: dismissible ? 'pointer' : 'default',
    } as Partial<CSSStyleDeclaration>);

    // 面板
    const panel = document.createElement('div');
    panel.className = '3dgs-popup-panel';
    panel.dataset.hotspotId = id;
    Object.assign(panel.style, {
      position: 'absolute',
      width: `${width}px`,
      maxWidth: 'calc(100% - 32px)',
      maxHeight: 'calc(100% - 64px)',
      overflowY: 'auto',
      background: 'rgba(18, 20, 26, 0.92)',
      color: '#eee',
      borderRadius: '10px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      border: '1px solid rgba(255,255,255,0.12)',
      padding: '14px 16px',
      fontSize: '13px',
      lineHeight: '1.6',
      cursor: 'default',
      animation: '3dgs-popup-in 0.18s ease-out',
      backdropFilter: 'blur(8px)',
    } as Partial<CSSStyleDeclaration>);
    panel.addEventListener('click', (e) => e.stopPropagation());

    // 标题行 + 关闭按钮
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px',
      marginBottom: popup.title ? '8px' : '0',
    } as Partial<CSSStyleDeclaration>);
    if (popup.title) {
      const title = document.createElement('div');
      title.textContent = popup.title;
      Object.assign(title.style, { fontWeight: '600', fontSize: '14px' } as Partial<CSSStyleDeclaration>);
      header.appendChild(title);
    }
    if (dismissible) {
      const closeBtn = document.createElement('div');
      closeBtn.className = '3dgs-popup-close';
      closeBtn.textContent = '✕';
      Object.assign(closeBtn.style, {
        cursor: 'pointer', opacity: '0.6', padding: '0 2px', fontSize: '14px', flexShrink: '0',
      } as Partial<CSSStyleDeclaration>);
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePopup();
      });
      header.appendChild(closeBtn);
    }
    panel.appendChild(header);

    // 图片 (可选)
    if (popup.imageUrl) {
      const img = document.createElement('img');
      img.src = popup.imageUrl;
      Object.assign(img.style, {
        width: '100%', borderRadius: '6px', marginBottom: popup.content ? '8px' : '0', display: 'block',
      } as Partial<CSSStyleDeclaration>);
      img.addEventListener('error', () => { img.style.display = 'none'; });
      panel.appendChild(img);
    }

    // 内容 (文本/HTML 片段)
    if (popup.content) {
      const content = document.createElement('div');
      content.innerHTML = popup.content; // 配置来源为受信任的 tour.json; 如需用户输入请先消毒
      content.style.color = 'rgba(255,255,255,0.82)';
      panel.appendChild(content);
    }

    overlay.appendChild(panel);
    if (dismissible) {
      overlay.addEventListener('click', () => this.closePopup());
    }
    this.container.appendChild(overlay);

    this.popupOverlay = overlay;
    this.popupPanel = panel;
    this.openPopupId = id;
    this.layoutPopup(instance, popup.placement);
    this.onPopupOpenHandler?.(instance);
    return true;
  }

  /** ★ 关闭弹出面板 */
  closePopup(): void {
    if (!this.openPopupId) return;
    const instance = this.hotspots.get(this.openPopupId) ?? null;
    this.popupOverlay?.remove();
    this.popupOverlay = undefined;
    this.popupPanel = undefined;
    this.openPopupId = undefined;
    this.popupScreen = null;
    this.onPopupCloseHandler?.(instance);
  }

  /** 面板布局: 跟随热点屏幕位置 (防越界) 或居中 */
  private layoutPopup(instance: HotspotInstance, placement: 'auto' | 'center' = 'auto'): void {
    const panel = this.popupPanel;
    const overlay = this.popupOverlay;
    if (!panel || !overlay) return;

    const hostW = overlay.clientWidth || 1;
    const hostH = overlay.clientHeight || 1;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;

    let left: number;
    let top: number;
    if (placement === 'center' || !this.popupScreen) {
      left = (hostW - w) / 2;
      top = (hostH - h) / 2;
    } else {
      // 热点上方优先, 越界自动翻转到下方/水平收拢
      const { x, y } = this.popupScreen;
      left = x - w / 2;
      top = y - h - 24;
      if (top < 8) top = y + 24;
      if (top + h > hostH - 8) top = Math.max(8, (hostH - h) / 2);
      left = Math.max(8, Math.min(left, hostW - w - 8));
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
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

        // ★ 记录屏幕坐标 — 弹出面板跟随锚点用
        instance.screenPos = { x: screenX, y: screenY };

        // 距离衰减
        const opacity = vis?.maxDistance
          ? Math.max(0.3, 1 - distance / vis.maxDistance)
          : 1;
        el.style.opacity = String(opacity);
      } else {
        el.style.display = 'none';
      }

      // ★ 弹出面板跟随: 打开中的面板随热点屏幕位置更新 (位移 >1px 才重排, 避免每帧强制布局;
      //   热点不可见时保持最后位置)
      if (this.openPopupId === config.id && visible && config.popup && instance.screenPos) {
        const sp = instance.screenPos;
        const prev = this.popupScreen;
        if (!prev || Math.abs(prev.x - sp.x) > 1 || Math.abs(prev.y - sp.y) > 1) {
          this.popupScreen = sp;
          this.layoutPopup(instance, config.popup.placement);
        }
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
      @keyframes 3dgs-popup-in {
        from { opacity: 0; transform: translateY(6px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
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
