# 3DGS Web Renderer

> A lightweight, high-performance 3D Gaussian Splatting rendering engine & tour framework for the Web

[![CI](https://img.shields.io/github/actions/workflow/status/sacrtap/3dgs/ci.yml?branch=main&label=CI)](https://github.com/sacrtap/3dgs/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@3dgs/core?label=%403dgs%2Fcore)](https://www.npmjs.com/package/@3dgs/core)
[![npm version](https://img.shields.io/npm/v/@3dgs/renderer-three?label=%403dgs%2Frenderer-three)](https://www.npmjs.com/package/@3dgs/renderer-three)
[![npm downloads](https://img.shields.io/npm/dm/@3dgs/core?label=downloads)](https://www.npmjs.com/package/@3dgs/core)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-blue.svg)](https://www.typescriptlang.org)

**English** | [中文](README.cn.md)

---

## Quick Start

### 1. Install

```bash
npm install @3dgs/core @3dgs/renderer-three @3dgs/plugins three @sparkjsdev/spark
```

> **React projects** also need `npm install react` (≥ 18)
> **Vue projects** also need `npm install vue` (≥ 3.4)

### 2. Embed a 3DGS Scene in 3 Lines

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';

const player = new TourPlayer(document.getElementById('viewer'));
const { renderer } = await createRenderer();
player.setRenderer(renderer);
await player.load('/tour.json');  // Load scene config — renders immediately
```

### 3. Try the Demo

```bash
git clone https://github.com/sacrtap/3dgs.git
cd 3dgs && pnpm install && pnpm --filter @3dgs/demo dev
```

Open `http://localhost:5173` to experience multi-scene tours, hotspot navigation, depth occlusion, touch gestures, and more.

<details>
<summary>📦 Dependency notes</summary>

- `three` and `@sparkjsdev/spark` are peerDependencies of `@3dgs/renderer-three` — install them manually
- The demo requires COOP/COEP cross-origin isolation headers (pre-configured in Vite) for `SharedArrayBuffer`

</details>

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Framework Integration](#framework-integration)
  - [React](#react)
  - [Vue 3](#vue-3)
- [Data Conversion Tool](#data-conversion-tool)
- [Configuration](#configuration)
- [Plugins](#plugins)
- [Data Format Guide](#data-format-guide)
- [Browser Compatibility](#browser-compatibility)
- [Development](#development)
- [FAQ](#faq)
- [License](#license)

---

## Features

### Rendering Engine

- **WebGL2 + Spark** — 3DGS rendering via `@sparkjsdev/spark`, covering 98%+ of browsers
- **Device Tiering** — Auto-detects hardware (CPU cores, memory, GPU model) and dynamically adjusts render parameters
- **Adaptive Resolution** — Automatically lowers render resolution when FPS drops below threshold
- **DragLookControls** — Drag-to-look camera controls, similar to panorama viewers
- **Keyboard Movement** — WASD horizontal movement + QE vertical movement with speed interpolation

### Tour Framework

- **Declarative Config** — `tour.json` defines scene topology, camera params, quality settings
- **Multi-Scene Management** — Scene registration, switching, preloading
- **Plugin System** — Hotspots, camera controls, depth occlusion, etc. are all pluggable
- **Event Bus** — Inter-plugin communication and external event listening

### Data Formats

| Format | Description | Compression |
|--------|-------------|-------------|
| **PLY** | Raw 3DGS training output | 1× |
| **SPLAT** | antimatter15 format (32 bytes/splat) | ~1× |
| **SPZ** | Niantic SPZ v2 format (gzip compressed) | ~10× |
| **SOG** | Spatially Ordered Gaussians (streaming LOD) | On-demand |

### Plugin Ecosystem

| Plugin | Description |
|--------|-------------|
| **HotspotSystem** | Hotspots — scene navigation, info labels, URL links, auto-preload |
| **CameraControls** | Camera — drag rotate, wheel zoom, damping |
| **DepthOcclusion** | Depth occlusion — semi-transparent when hotspot is blocked |
| **TouchGestures** | Touch — pinch zoom, two-finger rotate, inertia |
| **SceneTransition** | Scene transitions — fade / fly / instant |
| **Fullscreen** | Fullscreen — double-click toggle, ESC to exit |
| **LoadingIndicator** | Loading indicator — spinner, progress percentage |
| **AutoRotate** | Auto-rotate — configurable speed/delay |
| **ShaderInjection** | Shader injection — custom GLSL code injection |

---

## Framework Integration

### React

```tsx
import { useMemo } from 'react';
import { TourViewer } from '@3dgs/react';
import { createRenderer } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';

function App() {
  const renderer = useMemo(() => createRenderer().then((r) => r.renderer), []);
  const plugins = useMemo(() => [createHotspotSystem()], []);

  return (
    <TourViewer
      config="/tour.json"
      initialScene="kitchen"
      renderer={() => renderer}
      plugins={plugins}
      onSceneSwitch={(sceneId) => console.log('Scene switched:', sceneId)}
      onHotspotClick={(hotspotId) => console.log('Hotspot clicked:', hotspotId)}
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
```

> **Performance tip:** `renderer` and `plugins` props must use stable references (`useMemo` / `useRef`), otherwise TourViewer will rebuild the TourPlayer.

### Vue 3

```vue
<script setup lang="ts">
import { TourViewer } from '@3dgs/vue';
import { createRenderer } from '@3dgs/renderer-three';
import { createHotspotSystem } from '@3dgs/plugins';
import type { TourConfig } from '@3dgs/core';

const config: TourConfig = {
  version: '1.0',
  scenes: {
    kitchen: {
      source: '/kitchen.splat',
      initialView: { yaw: 0, pitch: 0, fov: 60 },
    },
  },
};

function createRendererInstance() {
  return createRenderer().then((r) => r.renderer);
}

const plugins = [createHotspotSystem()];
</script>

<template>
  <TourViewer
    :config="config"
    :renderer="createRendererInstance"
    :plugins="plugins"
    initial-scene="kitchen"
    @scene-switch="(id) => console.log('Scene switched:', id)"
    @hotspot-click="(id) => console.log('Hotspot clicked:', id)"
    style="width: 100vw; height: 100vh;"
  />
</template>
```

### Vanilla JS / TS

```typescript
import { TourPlayer } from '@3dgs/core';
import { createRenderer } from '@3dgs/renderer-three';
import {
  createHotspotSystem,
  createDepthOcclusionPlugin,
  createTouchGesturesPlugin,
} from '@3dgs/plugins';

const player = new TourPlayer(document.getElementById('viewer'));
const { renderer } = await createRenderer();
player.setRenderer(renderer);

player.use(createHotspotSystem());
player.use(createDepthOcclusionPlugin({ sampleInterval: 2 }));
player.use(createTouchGesturesPlugin());

player.on('load', () => console.log('Loaded'));
player.on('scene:switched', (data) => console.log('Scene switched:', data));
player.on('hotspot:click', (data) => console.log('Hotspot clicked:', data));

await player.load('/tour.json');
await player.switchScene('kitchen');

// player.destroy();
```

---

## Data Conversion Tool

Convert PLY files to optimized web formats:

```bash
# PLY → SPLAT (no compression, fastest loading)
npx 3dgs-convert ply-to-splat input.ply -o output.splat

# PLY → SPZ (gzip compressed, ~10x compression ratio)
npx 3dgs-convert ply-to-spz input.ply -o output.spz --sh-degree 1

# PLY → SOG (streaming LOD, progressive loading)
npx 3dgs-convert ply-to-sog input.ply -o output.sog

# .splat → .spz / .sog (reverse conversion)
npx 3dgs-convert splat-to-spz input.splat -o output.spz
npx 3dgs-convert splat-to-sog input.splat -o output.sog

# Batch convert all PLY files in a directory
npx 3dgs-convert batch ./scenes/ --format spz --sh-degree 1

# Generate tour.json config template
npx 3dgs-convert generate-tour ./scenes/ -o tour.json

# View file info
npx 3dgs-convert info input.ply
```

<details>
<summary>CLI options</summary>

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Output file path |
| `--prune` | Enable redundant gaussian pruning |
| `--min-opacity <num>` | Min opacity threshold (default 0.01) |
| `--sort` | Enable Morton Code spatial sorting |
| `--no-sort` | Disable sorting (SOG only, enabled by default) |
| `--sh-degree <num>` | SH degree 0-3 (auto-detected by default) |
| `--fractional-bits <num>` | SPZ position quantization fractional bits (default 12) |
| `--chunk-size <num>` | SOG splats per chunk (default 16384) |

</details>

---

## Configuration

Tour configs use a declarative JSON format (`tour.json`) defining scene topology, camera params, and quality settings:

```json
{
  "version": "1.0",
  "meta": { "title": "Virtual Tour", "description": "Apartment walkthrough" },
  "defaults": {
    "camera": { "fov": 60, "minFov": 30, "maxFov": 90, "limitPitch": [-80, 80] },
    "transition": { "type": "fade", "duration": 800 },
    "quality": { "maxSplats": 1000000, "shDegree": 1, "resolution": 1.0 }
  },
  "scenes": {
    "kitchen": {
      "title": "Kitchen",
      "source": "/kitchen.spz",
      "initialView": { "yaw": 0, "pitch": 0, "fov": 60 },
      "extensions": {
        "hotspot": {
          "hotspots": [
            {
              "id": "to-living",
              "type": "scene",
              "position": [1.0, 1.5, -2.0],
              "targetScene": "living",
              "style": { "glow": true, "color": "#80a0ff", "size": 36 },
              "onHover": { "tooltip": "Go to living room" }
            }
          ]
        }
      }
    },
    "living": {
      "title": "Living Room",
      "source": "/living.spz",
      "initialView": { "yaw": 90, "pitch": 0, "fov": 60 }
    }
  }
}
```

**Hotspot types:** `scene` (scene navigation), `text` (info label), `url` (link), `image` (image), `custom` (custom)

---

## Plugins

### Using Built-in Plugins

```typescript
import {
  createHotspotSystem,
  createCameraControls,
  createDepthOcclusionPlugin,
  createTouchGesturesPlugin,
  createSceneTransitionPlugin,
  createFullscreenPlugin,
  createLoadingIndicatorPlugin,
  createAutoRotatePlugin,
} from '@3dgs/plugins';

player.use(createHotspotSystem());
player.use(createCameraControls({ enableDamping: true }));
player.use(createLoadingIndicatorPlugin());
```

### Developing Custom Plugins

```typescript
import type { TourPlugin, FrameContext, TourPluginContext } from '@3dgs/core';

function createMyPlugin(): TourPlugin {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    init(ctx: TourPluginContext) {
      // ctx.player / ctx.renderer / ctx.container / ctx.sceneManager
    },
    update(frameCtx: FrameContext) {
      // frameCtx.camera / frameCtx.vpMatrix / frameCtx.size / frameCtx.deltaTime
    },
    destroy() {
      // Cleanup
    },
  };
}

player.use(createMyPlugin());
```

<details>
<summary>Package API Reference</summary>

### @3dgs/core

| Export | Type | Description |
|--------|------|-------------|
| `TourPlayer` | Class | Tour player — frame loop, scene switching, plugin orchestration, event bus |
| `SceneManager` | Class | Scene registration, loading, switching, preloading |
| `TourLoader` | Class | Load TourConfig from URL or object |
| `PluginSystem` | Class | Plugin registration, per-frame update, destroy management |
| `RendererAdapter` | Interface | Renderer abstraction interface |
| `DeviceTier` | Enum | Device tier — LOW / MEDIUM / HIGH / ULTRA |
| `TourConfig` | Type | Declarative scene graph config format |
| `TourPlugin` | Interface | Plugin interface — `init` / `update` / `destroy` lifecycle |
| `validateTourConfig` | Function | Config validation |

### @3dgs/renderer-three

| Export | Type | Description |
|--------|------|-------------|
| `RenderManager` | Class | WebGL2 + Spark render manager |
| `createRenderer` | Function | Async renderer factory — auto-detects WebGPU, falls back to WebGL2 |
| `createRendererSync` | Function | Sync renderer factory — uses WebGL2 directly |
| `detectWebGPU` | Function | WebGPU capability detection |
| `detectDeviceTier` | Function | Device tier detection |
| `SogStreamer` | Class | SOG streaming LOD client |

### @3dgs/convert

| Export | Description |
|--------|-------------|
| `loadGaussiansFromPly(buffer, options?)` | Parse gaussian data from PLY |
| `loadGaussiansFromSplat(buffer, options?)` | Load `.splat` back into GaussianCloud |
| `writeSplat(cloud)` | Write `.splat` format |
| `writeSpz(cloud, options?)` | Write `.spz` format (gzip compressed) |
| `writeSog(cloud, options?)` | Write `.sog` format (streaming LOD) |
| `pruneGaussians(cloud, options?)` | Redundant gaussian pruning |
| `mortonSortGaussians(cloud, options?)` | Morton Code spatial sorting |
| `parsePly(buffer)` | Low-level PLY parser |
| `parseSogMetadata(buffer)` | Parse SOG file metadata |

</details>

---

## Data Format Guide

All three formats have **similar steady-state FPS** (variance < 5%). Format choice mainly affects loading experience and LOD quality.

### Recommended by Use Case

| Use Case | Recommended | Reason |
|----------|-------------|--------|
| Desktop / High bandwidth | `.splat` | No decode overhead, simplest loading |
| Mobile / 4G | `.spz` | Half the transfer size, faster loading |
| Large scene (> 1M splats) | `.sog` | Fast first frame + efficient LOD |
| Spherical harmonics lighting | `.spz` | Only format supporting SH |
| Multi-scene tours | `.sog` | Morton sorting improves LOD quality |

### Recommended by Device Tier

| Device Tier | Recommended | Reason |
|-------------|-------------|--------|
| LOW (250K max) | `.spz` | Small transfer + manageable data after truncation |
| MEDIUM (500K max) | `.spz` / `.sog` | Balance transfer and loading experience |
| HIGH (1M max) | `.sog` | Efficient LOD, smoother rendering |
| ULTRA (2.5M max) | `.splat` / `.sog` | No transfer bottleneck, LOD enhances quality |

<details>
<summary>Detailed format comparison</summary>

| Feature | .splat | .spz | .sog |
|---------|--------|------|------|
| **Bytes per splat** | 32 B | ~16 B (pre-compression) | 32 B (same as .splat) |
| **Compression** | None | gzip + quantization | None (chunked transfer) |
| **SH coefficients** | ✗ | ✓ (degree 0-3) | ✗ |
| **Streaming** | ✗ | ✗ | ✓ (HTTP Range) |
| **Morton sorting** | ✗ | ✗ | ✓ (LOD-friendly) |
| **Position precision** | Float32 | 24bit fixed | Float32 |
| **Network transfer** | Full | Full (compressed) | Progressive |
| **CPU decode overhead** | Lowest | Medium (decompress + dequantize) | Low |

</details>

---

## Browser Compatibility

| Browser | Min Version | Notes |
|---------|-------------|-------|
| Chrome / Edge | 113+ | WebGL2 + SharedArrayBuffer (COOP/COEP) |
| Firefox | 113+ | WebGL2 + SharedArrayBuffer |
| Safari | 16.4+ | WebGL2 (some features limited) |
| Mobile Chrome | 113+ | Touch gestures supported |
| Mobile Safari | 16.4+ | Touch gestures supported |

> **Cross-origin isolation required:** Set these HTTP headers to enable `SharedArrayBuffer`:
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> Cross-Origin-Resource-Policy: cross-origin
> ```

### Development Environment Configuration

If you are building a custom app (not using this repo's demo), you need to configure COOP/COEP headers in your dev server:

<details>
<summary>Vite</summary>

```javascript
// vite.config.js
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  // preview server also needs these headers
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  // Spark WASM must not be pre-bundled
  optimizeDeps: {
    exclude: ['@sparkjsdev/spark'],
  },
};
```

> [Source: project source — `apps/demo/vite.config.js`]

</details>

<details>
<summary>Webpack (webpack-dev-server v5)</summary>

```javascript
// webpack.config.js
module.exports = {
  devServer: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
};
```

</details>

<details>
<summary>Express / Node.js</summary>

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
```

</details>

> **Without these headers, `SharedArrayBuffer` is undefined and Spark falls back to single-threaded sorting, causing significant performance degradation.**

### Production Deployment Guide

Without these headers, the renderer falls back to single-threaded sorting, causing significant performance degradation. Below are configuration examples for common hosting platforms:

<details>
<summary>Nginx</summary>

Add `add_header` directives to your `server` or `location` block:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    # Cross-origin isolation headers (required for SharedArrayBuffer)
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;

    # Static assets for 3DGS files (.splat, .spz, .sog, .ply)
    location ~* \.(splat|spz|sog|ply)$ {
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
        add_header Cache-Control "public, max-age=31536000, immutable";
        gzip off;  # .spz is already gzip-compressed; .sog uses chunked transfer
    }

    location / {
        root /var/www/3dgs-demo;
        try_files $uri $uri/ /index.html;
    }
}
```

> **Note:** Use `always` to ensure headers are sent even on error responses (404, 500). Nginx `add_header` does not inherit from outer blocks by default — repeat headers in nested `location` blocks.

</details>

<details>
<summary>Vercel</summary>

Create a `vercel.json` in your project root:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" }
      ]
    }
  ]
}
```

> **Note:** Vercel automatically applies `Content-Encoding: gzip` for `.spz` files. No additional compression configuration needed.

</details>

<details>
<summary>Netlify</summary>

Create a `netlify.toml` in your project root:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Resource-Policy = "cross-origin"

# Optional: long-cache for 3DGS data files
[[headers]]
  for = "/*.splat"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.spz"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.sog"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

</details>

<details>
<summary>Cloudflare Pages</summary>

Create a `_headers` file in your build output directory (usually `public/` or `dist/`):

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin

/*.splat
  Cache-Control: public, max-age=31536000, immutable

/*.spz
  Cache-Control: public, max-age=31536000, immutable

/*.sog
  Cache-Control: public, max-age=31536000, immutable
```

> **Note:** Cloudflare's auto-minify and Rocket Loader features may interfere with 3DGS rendering. Disable them for your 3DGS deployment in the Cloudflare dashboard.

</details>

<details>
<summary>Verification</summary>

After deployment, verify cross-origin isolation is active:

1. Open browser DevTools → Console
2. Run: `self.crossOriginIsolated`
3. Should return `true`

If `false`:
- Check that **all three** headers are present (COOP, COEP, CORP)
- Use DevTools → Network → click any request → Response Headers to verify
- Ensure no `Cross-Origin-Embedder-Policy: unsafe-none` is set by a CDN or framework

</details>

---

## Development

<details>
<summary>Expand development guide</summary>

### Build

```bash
pnpm build                          # Build all packages
pnpm --filter @3dgs/core build      # Build a single package
pnpm --filter @3dgs/core dev        # Watch mode
```

### Code Quality

```bash
pnpm typecheck       # Type checking
pnpm test            # Unit tests (42 cases)
pnpm test:coverage   # Coverage report
pnpm lint            # ESLint
pnpm lint:fix        # Auto-fix
pnpm format          # Prettier
```

### Docs Site

```bash
pnpm --filter @3dgs/docs dev        # Dev server (http://localhost:5178)
pnpm --filter @3dgs/docs build      # Build static site
pnpm --filter @3dgs/docs preview    # Preview build
```

### CI/CD

GitHub Actions CI pipeline runs Lint, Type Check, Unit Tests, Build, and Benchmark on every push / PR.

</details>

---

## FAQ

For common questions, see the [FAQ docs](docs/site/guide/faq.md) covering deployment, rendering, data conversion, plugins, and build issues.

---

## Monorepo Structure

```
3dgs/
├── packages/
│   ├── core/              # Framework-agnostic core — TourPlayer, SceneManager, PluginSystem
│   ├── renderer-three/    # Three.js + Spark renderer adapter
│   ├── plugins/           # Plugins — hotspots, camera, depth, touch, transitions, shader
│   ├── convert/           # Data conversion CLI + programmatic API
│   ├── react/             # React adapter — <TourViewer /> component
│   └── vue/               # Vue 3 adapter — <TourViewer /> component
├── apps/
│   └── demo/              # Demo app (Vite + Vanilla TS)
├── examples/              # 9 example code files
├── docs/site/             # VitePress docs site
├── .changeset/            # Changesets version management
└── .github/               # CI/CD + Issue/PR templates
```

| Resource | Description |
|----------|-------------|
| [Docs Site](docs/site/) | VitePress docs — guides, API reference, examples |
| [Examples](examples/README.md) | 9 runnable code examples |
| [FAQ](docs/site/guide/faq.md) | Deployment, rendering, conversion, plugins, build |
| [Contributing](CONTRIBUTING.md) | Dev setup, branch strategy, plugin dev, commit conventions |

---

## License

[MIT](LICENSE)
