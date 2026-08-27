import { useEffect, useRef, useState } from 'react';
import { TourPlayer } from '@3dgs/core';
import type {
  TourConfig,
  TourPlugin,
  RendererAdapter,
  TourPlayerHandler,
} from '@3dgs/core';

export interface TourViewerProps {
  config: string | TourConfig;
  initialScene?: string;
  /** 渲染器实例或工厂函数 (必需) */
  renderer: RendererAdapter | (() => RendererAdapter);
  /** 插件列表 (如 createHotspotSystem()) */
  plugins?: TourPlugin[];
  className?: string;
  style?: React.CSSProperties;
  onLoad?: TourPlayerHandler;
  onSceneSwitch?: (sceneId: string) => void;
  onHotspotClick?: (hotspotId: string) => void;
  onError?: (error: string) => void;
  onEvent?: (type: string, data: unknown) => void;
}

export function TourViewer({
  config,
  initialScene,
  renderer,
  plugins,
  className,
  style,
  onLoad,
  onSceneSwitch,
  onHotspotClick,
  onError,
  onEvent,
}: TourViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TourPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ★ 使用 ref 包裹回调, 避免回调变化导致 TourPlayer 重建
  const callbacksRef = useRef({
    onLoad,
    onSceneSwitch,
    onHotspotClick,
    onError,
    onEvent,
  });
  callbacksRef.current = { onLoad, onSceneSwitch, onHotspotClick, onError, onEvent };

  // ★ 使用 ref 包裹 config 和 initialScene, 仅在真正变化时触发
  const configRef = useRef(config);
  const initialSceneRef = useRef(initialScene);
  // ★ D-05: 首次挂载守卫 — 主 effect 已负责首次 load,
  //   [config] effect 首挂载执行会触发双重加载 (load 事件两次/请求重复)
  const isFirstMount = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const player = new TourPlayer(container);
    playerRef.current = player;

    // 挂载渲染器
    const rendererInstance =
      typeof renderer === 'function' ? renderer() : renderer;
    player.setRenderer(rendererInstance);

    // 注册插件
    if (plugins) {
      for (const plugin of plugins) {
        player.use(plugin);
      }
    }

    const unsubs: (() => void)[] = [];

    const cb = callbacksRef.current;

    unsubs.push(player.on('load', (data) => {
      setError(null);
      cb.onLoad?.(data);
      cb.onEvent?.('load', data);

      if (initialSceneRef.current) {
        player.switchScene(initialSceneRef.current).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          cb.onError?.(msg);
          cb.onEvent?.('error', { message: msg });
        });
      }
    }));

    unsubs.push(player.on('scene:switched', (data) => {
      const d = data as { sceneId: string };
      cb.onSceneSwitch?.(d.sceneId);
      cb.onEvent?.('scene:switched', data);
    }));

    unsubs.push(player.on('hotspot:click', (data) => {
      const d = data as { id: string };
      cb.onHotspotClick?.(d.id);
      cb.onEvent?.('hotspot:click', data);
    }));

    unsubs.push(player.on('error', (data) => {
      const d = data as { message: string };
      setError(d.message);
      cb.onError?.(d.message);
      cb.onEvent?.('error', d);
    }));

    player.load(configRef.current).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      cb.onError?.(msg);
      cb.onEvent?.('error', { message: msg });
    });

    return () => {
      unsubs.forEach((fn) => fn());
      player.destroy();
      playerRef.current = null;
    };
    // ★ 仅在 renderer 或 plugins 引用变化时重建 TourPlayer
    // config 和回调通过 ref 传递, 不触发重建
  }, [renderer, plugins]);

  // ★ config 变化时重新加载 (不重建 TourPlayer)
  useEffect(() => {
    configRef.current = config;

    // ★ D-05: 跳过首次挂载 — 首次加载由主 effect ([renderer, plugins]) 负责,
    //   避免两个 effect 都在挂载时执行 player.load() 导致双重加载
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const player = playerRef.current;
    if (!player) return;

    setError(null);
    player.load(config).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      callbacksRef.current.onError?.(msg);
    });
  }, [config]);

  // ★ initialScene 变化时更新 ref
  useEffect(() => {
    initialSceneRef.current = initialScene;
  }, [initialScene]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative' as const,
        overflow: 'hidden',
        ...style,
      }}
    >
      {error && (
        <div style={{
          position: 'absolute',
          bottom: 16, left: 16, right: 16,
          padding: '8px 16px',
          background: 'rgba(220, 38, 38, 0.9)',
          color: '#fff',
          borderRadius: 6,
          fontSize: 14,
          zIndex: 10,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
