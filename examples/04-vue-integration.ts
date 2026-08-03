/**
 * 示例 4: Vue 集成
 */

import { defineComponent } from 'vue';
import { TourViewer } from '@3dgs/vue';
import { createHotspotSystem } from '@3dgs/plugins';

export default defineComponent({
  name: 'App',
  components: { TourViewer },
  setup() {
    const config = {
      version: '1.0',
      scenes: {
        main: {
          title: '主场景',
          source: '/scenes/room.splat',
          initialView: { yaw: 0, pitch: 0, fov: 60 },
        },
      },
    };

    const plugins = [createHotspotSystem()];

    const onSceneSwitched = (sceneId: string) => console.log('切换到:', sceneId);
    const onError = (err: Error) => console.error(err);

    return { config, plugins, onSceneSwitched, onError };
  },
  template: `
    <TourViewer
      :config="config"
      initial-scene="main"
      :plugins="plugins"
      @scene-switched="onSceneSwitched"
      @error="onError"
      style="width: 100%; height: 100vh;"
    />
  `,
});
