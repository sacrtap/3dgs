/**
 * @3dgs + React Three Fiber 生态适配示例 (★ R-10)
 *
 * 分层渲染方案:
 *   - 底层: TourViewer (@3dgs/react) 渲染 3DGS splat 场景 (自有 WebGL context)
 *   - 顶层: R3F Canvas 渲染 UI/辅助层 (透明覆盖, 独立 WebGL context)
 *
 * 两个 WebGL context 并存合法 (不同 canvas), 注意 R3F 层不接收指针事件
 * (pointer-events: none), 交互留给 3DGS 层与 DOM 层。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { TourViewer } from '@3dgs/react';
import { createRendererSync } from '@3dgs/renderer-three';
import { R3FOverlay } from './overlay';

// 示例场景 — 使用 demo 的 kitchen 资产 (也可替换为任意 .splat/.spz/.ply URL)
const demoConfig = {
  version: '1.0' as const,
  meta: { title: 'R3F 集成示例' },
  scenes: {
    kitchen: {
      source: '/kitchen.splat',
    },
  },
};

export function App() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 底层: 3DGS 场景 */}
      <div className="viewer-layer">
        <TourViewer config={demoConfig} renderer={() => createRendererSync()} initialScene="kitchen" />
      </div>
      {/* 顶层: R3F UI 覆盖层 */}
      <div className="r3f-layer">
        <Canvas gl={{ antialias: true, alpha: true }} camera={{ position: [0, 0, 5], fov: 45 }}>
          <R3FOverlay />
        </Canvas>
      </div>
      <div className="hud">
        <div>3DGS 场景由 @3dgs/renderer-three 渲染</div>
        <div>UI 覆盖层由 React Three Fiber 渲染</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
