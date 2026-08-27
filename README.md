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

- **Dual Backend** — WebGL2 + Spark (production-ready, 98%+ browsers) **and** WebGPU native (experimental, WGSL shaders + GPU compute sort)
- **Device Tiering** — Auto-detects hardware (CPU cores, memory, GPU model, touch capability — iPadOS correctly classified as mobile) and dynamically adjusts render parameters
- **Adaptive Resolution** — Automatically lowers render resolution when FPS drops below threshold; suspended during scene loading to avoid false downscaling, capped pixel-ratio follow on HIGH/ULTRA tiers for high-DPI sharpness
- **Power & Battery Aware** — Render loop pauses automatically when the page is hidden (visibilitychange), resumes without frame-time spikes
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
| **SPZ** | Niantic SPZ v2 format (gzip compressed) | ~2× measured from .splat |
| **SOG** | Spatially Ordered Gaussians (streaming LOD) | On-demand |

> **Benchmark highlights (2026-08-27, 5 scenes × formats):** On a 248K-splat scene all formats render at ~60 FPS — SPZ loads fastest (405 ms, 48% the size of .splat); for large scenes (>1M splats) SOG loads fastest (1.2 s vs 10.9 s for .splat on a 5.8M scene) with equal FPS. Conversion throughput ≈ 120K–500K splats/s. See the [full performance report](benchmarks/reports/performance-report-full-2026-08-27.md).

### Plugin Ecosystem

| Plugin | Description |
|--------|-------------|
| **HotspotSystem** | Hotspots — scene navigation, info labels, URL links, auto-preload, **click popup panels** |
| **MediaEmbed** | Spatial media — embed images/videos into the scene as world-space planes (seamless blending, video playback) |
| **CameraControls** | Camera — drag rotate, wheel zoom, damping |
| **DepthOcclusion** | Depth occlusion — semi-transparent when hotspot is blocked |
| **TouchGestures** | Touch — pinch zoom, two-finger rotate, inertia |
| **SceneTransition** | Scene transitions — fade / fly / instant |
| **Fullscreen** | Fullscreen — double-click toggle, ESC to exit |
| **LoadingIndicator** | Loading indicator — spinner, progress percentage |
| **AutoRotate** | Auto-rotate — configurable speed/delay |
| **ShaderInjection** | Shader injection — custom GLSL (WebGL2) / WGSL (WebGPU) code injection + **built-in preset effects** |

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

The `@3dgs/convert` package is [published on npm](https://www.npmjs.com/package/@3dgs/convert) (v0.2.0). You can use it directly via `npx` without installation, or install it globally:

```bash
# Use directly via npx (no installation required)
npx 3dgs-convert <command> [options]

# Or install globally
npm install -g @3dgs/convert
3dgs-convert <command> [options]
```

Convert PLY files to optimized web formats:

```bash
# PLY → SPLAT (no compression, fastest loading)
npx 3dgs-convert ply-to-splat input.ply -o output.splat

# PLY → SPZ (gzip compressed, ~2x smaller than .splat measured)
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
| `--chunk-size <num>` | SOG splats per chunk (default 8192) |
| `--contribution-cutoff <num>` | Contribution-based pruning (0-1 = keep ratio, >1 = keep count) |
| `--sh-mode <num>` | SOG SH DC append mode (0=off, 1=Int8, default 0) |

</details>

<details>
<summary>Parameter guide: quality, size & performance tuning</summary>

### Pruning & filtering (`--prune`, `--min-opacity`, `--contribution-cutoff`)

These parameters control **which gaussians are kept** vs. discarded during conversion. Pruning reduces file size and improves runtime performance at the cost of visual fidelity.

| Parameter | Effect on quality | Effect on file size | When to use |
|-----------|-------------------|---------------------|-------------|
| `--prune` | Enables base-level filtering: removes NaN/Inf gaussians, fully transparent splats (opacity below `--min-opacity`), and abnormally scaled splats. Minimal visual impact. | Slight reduction (~1-5%) | Always recommended — cleans training artifacts |
| `--min-opacity 0.01` (default) | Threshold below which a gaussian is considered invisible. Lower = keep more near-transparent splats. Higher = more aggressive culling. | Higher value → smaller file | Increase to `0.05` for mobile/web; keep `0.01` for archival quality |
| `--min-opacity 0.05` | Removes more low-contribution splats. May lose subtle fog/haze effects. | Moderate reduction (~5-15%) | Mobile, low-end devices, bandwidth-constrained |
| `--contribution-cutoff 0.8` | Keeps only the top 80% highest-contribution gaussians (contribution = opacity × max scale). Discards the bottom 20% — typically training noise or background fill. | ~20% reduction | Quality-vs-size tradeoff for web deployment |
| `--contribution-cutoff 500000` | Keeps exactly the top 500,000 gaussians by contribution. Useful for hard cap on splat count. | Significant reduction if original has millions | Enforcing device tier limits (e.g. mobile max 500K splats) |

**Quality tuning tips:**
- Start with `--prune --min-opacity 0.01` (safe defaults) and inspect the output visually.
- If file size is too large, try `--contribution-cutoff 0.8` (keep top 80%).
- For mobile targets, `--contribution-cutoff 500000 --min-opacity 0.05` is a good starting point.
- Always compare the converted output against the source PLY render to assess quality loss.

### SH degree (`--sh-degree`) — SPZ format only

Controls the level of spherical harmonics (view-dependent color) preserved in the output. Higher = better angular color accuracy but larger file.

| Value | SH terms | Extra size per splat | Visual effect |
|-------|----------|---------------------|---------------|
| `0` | DC only | 0 bytes | Flat color, no view-dependent shading |
| `1` | 3 coeffs | +9 bytes | Basic directional shading (recommended for web) |
| `2` | 8 coeffs | +24 bytes | High-quality reflections, anisotropic effects |
| `3` | 15 coeffs | +45 bytes | Full SH fidelity (matches training source) |

- **Default**: auto-detected from the PLY file's SH count.
- `--sh-degree 0` strips all SH data — smallest file, but surfaces look flat under rotation.
- `--sh-degree 1` is the sweet spot for web: captures most view-dependent effects at ~30% size increase.
- Only the `ply-to-spz` and `batch` commands support this option (`.splat` format has no SH).

### Position quantization (`--fractional-bits`) — SPZ format only

Controls the precision of gaussian **positions** via fixed-point quantization. Lower = smaller file but positional jitter.

| Value | Precision (for 100m scene) | File impact | Visual impact |
|-------|---------------------------|-------------|---------------|
| `12` (default) | ~0.024 mm | Baseline | Imperceptible |
| `10` | ~0.098 mm | ~3% smaller | Negligible |
| `8` | ~0.39 mm | ~6% smaller | Slight ghosting on close-up |
| `14` | ~0.006 mm | ~3% larger | Sub-pixel precision (overkill for most cases) |

- The quantization range is ±8,388,607 (24-bit signed), so `fractionalBits` determines the world-space resolution.
- For typical indoor scenes (~10m), even `fractionalBits=10` provides sub-millimeter precision.
- For large outdoor scenes (~1km), keep `fractionalBits=12` to avoid visible positional errors.

### SOG chunk size (`--chunk-size`) — SOG format only

Controls how many gaussians are grouped per chunk for streaming. Smaller chunks = faster first-frame but more HTTP requests.

| Value | First chunk download | Total chunks (1M splats) | Use case |
|-------|----------------------|--------------------------|----------|
| `8192` (default) | ~256 KB (32B/splat) | ~122 | Balanced first-frame speed and overhead |
| `4096` | ~128 KB | ~244 | Faster first paint on slow networks |
| `16384` | ~512 KB | ~61 | Better compression ratio, slower first paint |
| `32768` | ~1 MB | ~31 | Best for local/high-bandwidth, max compression |

- Each chunk is independently gzip-compressed, so larger chunks achieve better compression ratios.
- Smaller chunks enable progressive rendering sooner but increase per-chunk overhead (HTTP headers, decompression).
- Default `8192` is tuned for typical web deployment (3G/4G networks).

### SOG SH mode (`--sh-mode`) — SOG format only

Controls whether SH DC (0th-order spherical harmonics) color data is appended to each splat in the SOG file, enabling view-dependent shading.

| Value | Extra bytes/splat | File size increase | Effect |
|-------|-------------------|--------------------|--------|
| `0` (default) | 0 | Baseline | No view-dependent color; uses flat DC color from .splat format |
| `1` | +3 bytes | ~+9.4% | Appends Int8-quantized SH DC coefficients, enabling basic directional color shifts |

- `--sh-mode 1` is useful when the source PLY has SH data but you want SOG streaming with view-dependent shading.
- The 3 extra bytes store the R/G/B SH DC coefficients (Int8 quantized via `round(sh × 128) + 128`).
- This is a lighter alternative to full SH preservation — only the DC term is kept, not higher-order SH.

### Morton spatial sorting (`--sort` / `--no-sort`)

Controls whether gaussians are reordered by their 3D position (Z-order / Morton curve) before writing.

| Setting | Effect | When |
|---------|--------|------|
| `--sort` (splat/spz) | Reorders gaussians spatially. Improves GPU cache locality and enables efficient frustum culling at runtime. | Recommended for production deployment |
| Default for SOG | SOG auto-enables sorting (required for LOD prefix subsets and chunk spatial coherence). | Always on for SOG |
| `--no-sort` (SOG only) | Disables sorting. Faster conversion but loses streaming LOD quality (first chunks no longer spatially coherent). | Debugging/testing only |

- Morton sorting uses 16-bit per-axis resolution (65536 levels), providing sufficient spatial granularity for scenes up to ~1km.
- Sorting adds O(N log N) overhead during conversion but significantly improves runtime rendering performance.

</details>

<details>
<summary>Large file conversion & OOM handling</summary>

When converting large PLY files (e.g. >50 MB / 3M+ gaussians), Node.js may crash with `JavaScript heap out of memory` (OOM) because the default V8 heap limit (~2 GB) is insufficient.

Increase the heap limit via the `NODE_OPTIONS` environment variable:

```bash
# Increase to 8 GB (recommended for large files)
NODE_OPTIONS="--max-old-space-size=8192" npx 3dgs-convert ply-to-sog large-scene.ply -o output.sog

# Or 4 GB for medium files
NODE_OPTIONS="--max-old-space-size=4096" npx 3dgs-convert ply-to-spz large-scene.ply -o output.spz
```

| File size | Gaussians | Recommended heap |
|-----------|-----------|-----------------|
| < 30 MB | < 1M | Default (2 GB) |
| 30–70 MB | 1M–4M | 4 GB |
| > 70 MB | > 4M | 8 GB+ |

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
| `RenderManager` | Class | WebGL2 + Spark render manager (production) |
| `WebGPURenderManager` | Class | WebGPU native render manager (experimental) |
| `WebGPUSortManager` | Class | GPU compute shader sort manager |
| `createRenderer` | Function | Async renderer factory — auto-detects WebGPU, falls back to WebGL2 |
| `createRendererSync` | Function | Sync renderer factory — uses WebGL2 directly |
| `detectWebGPU` | Function | WebGPU capability detection |
| `detectDeviceTier` | Function | Device tier detection |
| `SogStreamer` | Class | SOG streaming LOD client |
| `FrustumCulling` | Class | Morton spatial grid frustum culling |
| `SplatBufferPool` | Class | ArrayBuffer pool for scene switching |
| `decodeSpzInWorker` | Function | SPZ format decoder (Worker with main-thread fallback) |

### @3dgs/convert

| Export | Description |
|--------|-------------|
| `loadGaussiansFromPly(buffer, options?)` | Parse gaussian data from PLY |
| `loadGaussiansFromSplat(buffer, options?)` | Load `.splat` back into GaussianCloud |
| `writeSplat(cloud)` | Write `.splat` format |
| `writeSpz(cloud, options?)` | Write `.spz` format (gzip compressed) |
| `writeSog(cloud, options?)` | Write `.sog` format (streaming LOD, v2: gzip + LOD tree + position quantization) |
| `pruneGaussians(cloud, options?)` | Redundant gaussian pruning |
| `mortonSortGaussians(cloud, options?)` | Morton Code spatial sorting |
| `parsePly(buffer)` | Low-level PLY parser |
| `parseSogMetadata(buffer)` | Parse SOG file metadata |
| `buildLodLevels(numSplats, numLevels, lodBase)` | Build LOD level boundaries (Morton prefix subset) |
| `serializeLodTree(levels, lodBase)` | Serialize LOD tree to binary |
| `deserializeLodTree(buffer)` | Deserialize LOD tree from binary |

</details>

---

## Data Format Guide

All three formats have **similar steady-state FPS** (variance < 5%) on small scenes. Format choice mainly affects loading experience and transfer size. Verified by the [2026-08-27 full benchmark](benchmarks/reports/performance-report-full-2026-08-27.md):

| Format | Load time (248K scene) | File size | Notes |
|--------|-----------------------|-----------|-------|
| SPLAT | 529 ms | 7.6 MB | Simplest pipeline, best for desktop |
| SPZ | **405 ms** | 3.7 MB (48%) | Best for mobile / slow networks |
| SOG | 444 ms | 7.2 MB | Streaming first frame; fastest load for large scenes |

> ⚠️ For scenes over 1M splats, prefer **SOG** or **SPLAT**: the SPZ native path does not downsample, and unconverted PLY performs worst.
>
> ⚠️ **Quality note:** On large scenes the renderer downsamples `.splat`/`.sog` to the device-tier `maxSplats` cap (250K–2.5M) for performance, while direct `.ply` loading renders the full count — so a converted file can *look* lower quality than the original even though the conversion is near-lossless (verified ≤ 0.5/255 color error). See [conversion quality analysis](docs/convert-quality-analysis.md).

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
pnpm test            # Unit tests (473 cases, no build required)
pnpm test:coverage   # Coverage report
pnpm lint            # ESLint
pnpm lint:fix        # Auto-fix
pnpm format          # Prettier
pnpm clean           # Remove all dist outputs (cross-platform)
```

### Performance Benchmarks

```bash
pnpm build && (cd apps/demo && npx vite preview --port 4173)
node benchmarks/run-benchmark-full.mjs          # Render-side: 5 scenes × formats (Playwright)
node benchmarks/run-convert-full.mjs            # Conversion: perf + quality (13 tasks)
```

Reports are generated under `benchmarks/reports/`. Latest: [performance-report-full-2026-08-27.md](benchmarks/reports/performance-report-full-2026-08-27.md).

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
│   ├── renderer-three/    # Three.js + Spark / WebGPU renderer adapter
│   ├── plugins/           # Plugins — hotspots, camera, depth, touch, transitions, shader
│   ├── convert/           # Data conversion CLI + programmatic API
│   ├── react/             # React adapter — <TourViewer /> component
│   └── vue/               # Vue 3 adapter — <TourViewer /> component
├── apps/
│   └── demo/              # Demo app (Vite + Vanilla TS)
├── examples/              # 12 example code files
├── docs/site/             # VitePress docs site
├── .changeset/            # Changesets version management
└── .github/               # CI/CD + Issue/PR templates
```

| Resource | Description |
|----------|-------------|
| [Docs Site](docs/site/) | VitePress docs — guides, API reference, examples |
| [Examples](examples/README.md) | 12 runnable code examples |
| [FAQ](docs/site/guide/faq.md) | Deployment, rendering, conversion, plugins, build |
| [Contributing](CONTRIBUTING.md) | Dev setup, branch strategy, plugin dev, commit conventions |

---

## License

[MIT](LICENSE)
