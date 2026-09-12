# @3dgs + React Three Fiber 生态适配示例 (★ R-10)

展示将 `@3dgs/react` 的 `TourViewer` 与 React Three Fiber (R3F) 集成的最小示例。

## 架构

分层渲染方案:

```
┌────────────────────────────────┐
│ R3F Canvas (顶层, 透明, UI 层) │ ← @react-three/fiber
├────────────────────────────────┤
│ TourViewer (底层, 3DGS 场景)   │ ← @3dgs/react + renderer-three
└────────────────────────────────┘
```

- 3DGS splat 场景由 `@3dgs/renderer-three` (WebGL2 + Spark) 渲染, 自有 WebGL context;
- R3F Canvas 渲染 UI/辅助层 (箭头指示器、标注等), 独立 WebGL context;
- 两个 WebGL context 并存合法 (不同 canvas), R3F 层设置 `pointer-events: none`
  将交互留给 3DGS 层与 DOM 层。

## 运行

```sh
pnpm install
pnpm --filter @3dgs/r3f-example dev
```

打开 http://localhost:5173 查看 (需 COOP/COEP 头以启用 SharedArrayBuffer, 见 demo 的 vite 配置)。

> 场景数据默认引用 demo 的 `kitchen.splat` 资产; 替换 `src/main.tsx` 中的
> `demoConfig.scenes.kitchen.source` 为任意 `.splat`/`.spz`/`.ply` URL 即可。

## 说明

- `overlay.tsx` 中的 `R3FOverlay` 演示每帧跟随相机前方的箭头 (useFrame);
- 生产使用可把 R3F 层改为 HUD/导航/标注, 或仅用 3DGS 层 + DOM 覆盖层。
