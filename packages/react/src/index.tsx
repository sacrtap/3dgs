import { useEffect, useRef, useCallback, useState } from 'react';
import { TourPlayer } from '@3dgs/core';
import type {
  TourConfig,
  TourPlugin,
  RendererAdapter,
  TourPlayerEventType,
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

  const setErrorSafe = useCallback((msg: string) => {
    setError(msg);
    onError?.(msg);
    onEvent?.('error', { message: msg });
  }, [onError, onEvent]);

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

    unsubs.push(player.on('load', (data) => {
      setError(null);
      onLoad?.(data);
      onEvent?.('load', data);

      if (initialScene) {
        player.switchScene(initialScene).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorSafe(msg);
        });
      }
    }));

    unsubs.push(player.on('scene:switched', (data) => {
      const d = data as { sceneId: string };
      onSceneSwitch?.(d.sceneId);
      onEvent?.('scene:switched', data);
    }));

    unsubs.push(player.on('hotspot:click', (data) => {
      const d = data as { id: string };
      onHotspotClick?.(d.id);
      onEvent?.('hotspot:click', data);
    }));

    unsubs.push(player.on('error', (data) => {
      const d = data as { message: string };
      setErrorSafe(d.message);
    }));

    player.load(config).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorSafe(msg);
    });

    return () => {
      unsubs.forEach((fn) => fn());
      player.destroy();
      playerRef.current = null;
    };
  }, [config, initialScene, renderer, plugins, onLoad, onSceneSwitch, onHotspotClick, onError, onEvent, setErrorSafe]);

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
