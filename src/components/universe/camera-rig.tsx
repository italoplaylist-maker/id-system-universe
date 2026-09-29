"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";

/**
 * Predominantly isometric operations-center view: camera starts at a fixed
 * elevated angle, and orbit/zoom/pan are clamped so the user can inspect the
 * map but never gets lost in it (spec: "Limite câmera e zoom").
 */
export function CameraRig({ maxDistance }: { maxDistance: number }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[maxDistance * 0.6, maxDistance * 0.55, maxDistance * 0.6]} fov={40} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={maxDistance * 0.25}
        maxDistance={maxDistance * 1.1}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.3}
        target={[0, 0, 0]}
      />
    </>
  );
}
