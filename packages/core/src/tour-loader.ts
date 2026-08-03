import { TourConfig, validateTourConfig } from './tour-config.js';
import { SceneManager } from './scene-manager.js';

export interface TourRuntime {
  meta?: TourConfig['meta'];
  defaults?: TourConfig['defaults'];
  sceneManager: SceneManager;
  currentScene: string | null;
}

export class TourLoader {
  private configCache = new Map<string, TourConfig>();
  private abortController: AbortController | null = null;

  /**
   * 从 URL 加载 TourConfig JSON
   */
  async load(configUrl: string): Promise<TourRuntime> {
    // 检查缓存
    const cached = this.configCache.get(configUrl);
    if (cached) return this.buildRuntime(cached);

    this.abortController?.abort();
    this.abortController = new AbortController();

    const resp = await fetch(configUrl, {
      signal: this.abortController.signal,
      headers: { Accept: 'application/json' },
    });

    if (!resp.ok) {
      throw new Error(`加载 TourConfig 失败: ${resp.status} ${resp.statusText}`);
    }

    const raw: unknown = await resp.json();
    return this.fromObject(raw, configUrl);
  }

  /**
   * 从 JavaScript 对象加载 TourConfig
   */
  fromObject(config: unknown, source?: string): TourRuntime {
    if (!validateTourConfig(config)) {
      throw new Error('TourConfig 验证失败');
    }

    const tourConfig = config as TourConfig;

    if (source) {
      this.configCache.set(source, tourConfig);
    }

    return this.buildRuntime(tourConfig);
  }

  private buildRuntime(config: TourConfig): TourRuntime {
    const sceneManager = new SceneManager(config.defaults);

    // 注册所有场景元信息（按需加载 splat 数据）
    for (const [id, sceneConfig] of Object.entries(config.scenes)) {
      sceneManager.register(id, {
        ...sceneConfig,
        defaults: config.defaults,
      });
    }

    return {
      meta: config.meta,
      defaults: config.defaults,
      sceneManager,
      currentScene: null,
    };
  }

  /**
   * 清除配置缓存
   */
  clearCache() {
    this.configCache.clear();
  }

  /**
   * 取消正在进行的加载
   */
  abort() {
    this.abortController?.abort();
    this.abortController = null;
  }
}
