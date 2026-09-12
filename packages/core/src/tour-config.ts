/**
 * TourConfig — 声明式场景图配置格式 (对标 Krpano XML)
 * 定义整个漫游项目的场景拓扑、默认参数
 *
 * v4.1 变更: 移除 hotspots 字段，改用通用 extensions 扩展点
 * 热点配置类型已迁移至 @3dgs/plugins/hotspot
 */

// ─── 场景过渡 ────────────────────────────────────────────────

export interface SceneTransition {
  /**
   * 过渡类型。
   * - 'fade': CSS overlay 淡入淡出（生产就绪）
   * - 'fly': 相机沿路径飞行（TD-02: experimental — 当前无消费者，fly 帧数据无渲染器消费）
   * - 'instant': 无动画直接切换
   */
  type: 'fade' | 'fly' | 'instant';
  duration?: number;
  targetYaw?: number;
  targetPitch?: number;
  targetFov?: number;
}

// ─── 相机设置 ────────────────────────────────────────────────

export interface CameraSettings {
  fov: number;
  minFov: number;
  maxFov: number;
  limitPitch: [number, number];
}

// ─── 质量设置 ────────────────────────────────────────────────

export interface QualitySettings {
  maxSplats: number;
  shDegree: number;
  resolution: number; // 渲染缩放比 0.5-1.0
  antialias: boolean; // 是否开启抗锯齿 (默认 false)
  pixelRatio: number; // 像素比 (默认 1.0)
}

// ─── 场景配置 ────────────────────────────────────────────────

export interface SceneConfig {
  title?: string;
  /** .spz / .ply / .splat 文件路径 */
  source: string;
  /** SOG 流式格式 URL (可选, 用于大场景 LOD) */
  lodSource?: string;
  initialView?: {
    yaw: number;
    pitch: number;
    fov: number;
  };

  /**
   * ★ 通用扩展点 — 插件通过此字段挂载配置
   * 核心层不感知任何插件的配置 schema
   * 示例: { hotspot: { hotspots: [...] }, "scene-transition": { ... } }
   */
  extensions?: Record<string, unknown>;

  overrides?: {
    camera?: Partial<CameraSettings>;
    quality?: Partial<QualitySettings>;
  };
  info?: {
    description?: string;
    tags?: string[];
    thumbnail?: string;
  };
}

// ─── 元信息 ──────────────────────────────────────────────────

export interface TourMeta {
  title?: string;
  description?: string;
  author?: string;
  previewImage?: string;
}

export interface TourDefaults {
  camera?: CameraSettings;
  transition?: SceneTransition;
  quality?: QualitySettings;
}

// ─── 根配置 ──────────────────────────────────────────────────

export interface TourConfig {
  version: '1.0';
  meta?: TourMeta;
  defaults?: TourDefaults;
  scenes: Record<string, SceneConfig>;
}

// ─── 验证 ─────────────────────────────────────────────────────

const SUPPORTED_VERSIONS = ['1.0'];

export class TourConfigValidationError extends Error {
  constructor(message: string) {
    super(`TourConfig 验证失败: ${message}`);
    this.name = 'TourConfigValidationError';
  }
}

export function validateTourConfig(config: unknown): config is TourConfig {
  if (!config || typeof config !== 'object') {
    throw new TourConfigValidationError('配置必须是一个对象');
  }

  const c = config as Record<string, unknown>;

  // version
  if (!SUPPORTED_VERSIONS.includes(c.version as string)) {
    throw new TourConfigValidationError(
      `不支持的 version: ${c.version}，支持: ${SUPPORTED_VERSIONS.join(', ')}`,
    );
  }

  // scenes
  if (!c.scenes || typeof c.scenes !== 'object') {
    throw new TourConfigValidationError('缺少 scenes 字段');
  }

  const scenes = c.scenes as Record<string, unknown>;
  const sceneIds = Object.keys(scenes);
  if (sceneIds.length === 0) {
    throw new TourConfigValidationError('至少需要一个场景');
  }

  for (const [id, scene] of Object.entries(scenes)) {
    validateSceneConfig(id, scene as Record<string, unknown>);
  }

  return true;
}

function validateSceneConfig(id: string, scene: Record<string, unknown>) {
  if (!scene.source || typeof scene.source !== 'string') {
    throw new TourConfigValidationError(`场景 "${id}" 缺少 source 字段`);
  }
}

// ─── ★ TD-28: JSON 校验 (无 schema 运行时依赖, 收集错误而非抛错) ──

/** ★ TD-28: 校验结果 (valid=false 时 errors 含全部错误信息) */
export interface TourConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ★ TD-28: 校验 JSON 配置 — 返回结构化结果 (不抛错)。
 *
 * 配套 schema: `schema/tour-config.schema.json` (draft-07, IDE 提示与 CI 校验用)。
 * 运行时使用本函数做完整校验, 语义与 validateTourConfig 一致但收集全部错误。
 */
export function validateTourConfigJson(json: unknown): TourConfigValidationResult {
  const errors: string[] = [];

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { valid: false, errors: ['配置必须是一个对象'] };
  }

  const c = json as Record<string, unknown>;

  // version
  if (!SUPPORTED_VERSIONS.includes(c.version as string)) {
    errors.push(`不支持的 version: ${String(c.version)}，支持: ${SUPPORTED_VERSIONS.join(', ')}`);
  }

  // scenes
  if (!c.scenes || typeof c.scenes !== 'object' || Array.isArray(c.scenes)) {
    errors.push('缺少 scenes 字段');
    return { valid: errors.length === 0, errors };
  }

  const scenes = c.scenes as Record<string, unknown>;
  const sceneIds = Object.keys(scenes);
  if (sceneIds.length === 0) {
    errors.push('至少需要一个场景');
  }

  for (const [id, scene] of Object.entries(scenes)) {
    if (!scene || typeof scene !== 'object') {
      errors.push(`场景 "${id}" 必须是对象`);
      continue;
    }
    const s = scene as Record<string, unknown>;
    if (typeof s.source !== 'string' || s.source.length === 0) {
      errors.push(`场景 "${id}" 缺少 source 字段`);
    }
    if (s.lodSource !== undefined && typeof s.lodSource !== 'string') {
      errors.push(`场景 "${id}" lodSource 必须是字符串`);
    }
    if (
      s.initialView !== undefined &&
      (typeof s.initialView !== 'object' || s.initialView === null)
    ) {
      errors.push(`场景 "${id}" initialView 必须是对象`);
    }
  }

  return { valid: errors.length === 0, errors };
}
