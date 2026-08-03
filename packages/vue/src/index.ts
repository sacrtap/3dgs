import { defineComponent, ref, onMounted, onUnmounted, watch, h, type PropType } from 'vue';
import { TourPlayer } from '@3dgs/core';
import type { TourConfig, TourPlugin, RendererAdapter } from '@3dgs/core';

export const TourViewer = defineComponent({
  name: 'TourViewer',
  props: {
    config: { type: [String, Object] as PropType<string | TourConfig>, required: true },
    initialScene: { type: String, default: undefined },
    renderer: {
      type: [Object, Function] as PropType<RendererAdapter | (() => RendererAdapter)>,
      required: true,
    },
    plugins: {
      type: Array as PropType<TourPlugin[]>,
      default: () => [],
    },
  },
  emits: {
    load: (_data: unknown) => true,
    'scene-switch': (_sceneId: string) => true,
    'hotspot-click': (_hotspotId: string) => true,
    error: (_msg: string) => true,
  },
  setup(props, { emit, expose }) {
    const containerRef = ref<HTMLElement | null>(null);
    const errorMessage = ref<string | null>(null);
    let player: TourPlayer | null = null;

    function loadConfig(cfg: string | TourConfig) {
      if (!player) return;
      errorMessage.value = null;

      player.load(cfg).then(() => {
        if (props.initialScene) {
          player!.switchScene(props.initialScene).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            errorMessage.value = msg;
            emit('error', msg);
          });
        }
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        errorMessage.value = msg;
        emit('error', msg);
      });
    }

    onMounted(() => {
      if (!containerRef.value) return;
      player = new TourPlayer(containerRef.value);

      // 挂载渲染器
      const rendererInstance =
        typeof props.renderer === 'function'
          ? (props.renderer as () => RendererAdapter)()
          : props.renderer;
      player.setRenderer(rendererInstance);

      // 注册插件
      if (props.plugins) {
        for (const plugin of props.plugins) {
          player.use(plugin);
        }
      }

      player.on('load', (data) => emit('load', data));
      player.on('scene:switched', (data) => {
        const d = data as { sceneId: string };
        emit('scene-switch', d.sceneId);
      });
      player.on('hotspot:click', (data) => {
        const d = data as { id: string };
        emit('hotspot-click', d.id);
      });
      player.on('error', (data) => {
        const d = data as { message: string };
        errorMessage.value = d.message;
        emit('error', d.message);
      });

      loadConfig(props.config);
    });

    onUnmounted(() => {
      player?.destroy();
      player = null;
    });

    watch(() => props.config, (cfg) => loadConfig(cfg));

    expose({ getPlayer: () => player });

    return () => {
      const children = [];

      children.push(h('div', {
        ref: containerRef,
        style: { width: '100%', height: '100%', position: 'relative', overflow: 'hidden' },
      }));

      if (errorMessage.value) {
        children.push(h('div', {
          style: {
            position: 'absolute', bottom: '16px', left: '16px', right: '16px',
            padding: '8px 16px', background: 'rgba(220,38,38,0.9)', color: '#fff',
            borderRadius: '6px', fontSize: '14px', zIndex: 10,
          },
        }, errorMessage.value));
      }

      return h('div', {
        style: { position: 'relative', width: '100%', height: '100%' },
      }, children);
    };
  },
});

export default TourViewer;
