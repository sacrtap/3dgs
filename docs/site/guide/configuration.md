# 配置参考

TourConfig 是 3DGS 漫游框架的声明式配置，通过 JSON 对象定义场景、热点、相机等。

## 完整配置结构

```typescript
interface TourConfig {
  version: string;
  meta?: {
    title?: string;
    description?: string;
    author?: string;
  };
  defaults?: {
    camera?: {
      fov?: number;          // 视场角 (度), 默认 60
      minFov?: number;       // 最小视场角, 默认 30
      maxFov?: number;       // 最大视场角, 默认 90
      limitPitch?: [number, number]; // 俯仰角限制 (度)
    };
    transition?: {
      type?: 'fade' | 'fly' | 'instant';
      duration?: number;     // 毫秒
    };
  };
  scenes: Record<string, SceneConfig>;
}

interface SceneConfig {
  title?: string;
  source: string;            // .splat / .spz 文件路径
  lodSource?: string;        // SOG 流式 LOD URL (可选)
  initialView?: {
    yaw?: number;            // 水平角度 (度)
    pitch?: number;          // 垂直角度 (度)
    fov?: number;            // 视场角 (度)
  };
  extensions?: {
    hotspot?: {
      hotspots: HotspotConfig[];
    };
  };
}
```

## 配置示例

### 单场景

```json
{
  "version": "1.0",
  "scenes": {
    "main": {
      "title": "主场景",
      "source": "/scenes/room.splat",
      "initialView": { "yaw": 0, "pitch": 0, "fov": 60 }
    }
  }
}
```

### 多场景 + 热点跳转

```json
{
  "version": "1.0",
  "defaults": {
    "camera": { "fov": 60, "limitPitch": [-80, 80] },
    "transition": { "type": "fade", "duration": 800 }
  },
  "scenes": {
    "kitchen": {
      "title": "厨房",
      "source": "/scenes/kitchen.splat",
      "extensions": {
        "hotspot": {
          "hotspots": [
            {
              "id": "to-living",
              "type": "scene",
              "position": [1.0, 1.5, -2.0],
              "targetScene": "living",
              "transition": { "type": "fade", "duration": 600 },
              "style": { "glow": true, "pulse": true, "color": "#80a0ff" }
            }
          ]
        }
      }
    },
    "living": {
      "title": "客厅",
      "source": "/scenes/living.splat"
    }
  }
}
```

### SOG 流式 LOD

```json
{
  "version": "1.0",
  "scenes": {
    "large-scene": {
      "title": "大场景",
      "source": "/scenes/large.splat",
      "lodSource": "/scenes/large.sog"
    }
  }
}
```

## 配置加载方式

### 对象加载

```typescript
await player.load(configObject);
```

### URL 加载

```typescript
await player.load('https://example.com/tour.json');
```

## 热点配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 唯一标识 |
| `type` | `'text' \| 'scene' \| 'image'` | 热点类型 |
| `position` | `[x, y, z]` | 3D 空间坐标 |
| `targetScene` | `string` | (scene 类型) 目标场景 ID |
| `transition` | `object` | (scene 类型) 过渡参数 |
| `style` | `object` | 样式配置 (color, size, glow, pulse) |
| `onHover` | `object` | 悬停配置 (tooltip) |
