/**
 * R3F 覆盖层 — 展示与 3DGS 场景并存的 R3F 场景内容。
 *
 * 示例: 跟随相机前方的箭头指示器 + 坐标文字网格。
 * 实际项目中可在这一层叠加 HUD、导航箭头、标注线等。
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

export function R3FOverlay() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ camera }) => {
    // 箭头始终悬浮在相机前方 2 单位处
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    groupRef.current?.position.copy(camera.position).add(dir.multiplyScalar(2));
    groupRef.current?.lookAt(camera.position);
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <coneGeometry args={[0.12, 0.35, 4]} />
        <meshBasicMaterial color="#7cc4ff" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
