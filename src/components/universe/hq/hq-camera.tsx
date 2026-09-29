"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

interface HqCameraProps {
  radius: number;
  centerZ: number;
  /** World x,z of the room to focus on, or null to return to the overview shot. */
  focusTarget: [number, number] | null;
}

/**
 * Isometric-leaning camera over the whole building by default, with a smooth
 * orbit-target transition toward a room when one is focused (spec: "câmera
 * nunca teleporta bruscamente"). Zoom/pan/tilt stay clamped so the user can
 * never orbit under the floor or fly off into empty space.
 */
export function HqCamera({ radius, centerZ, focusTarget }: HqCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const desiredTarget = useRef(new THREE.Vector3(0, 0, centerZ));

  useEffect(() => {
    desiredTarget.current.set(focusTarget ? focusTarget[0] : 0, focusTarget ? 0.6 : 0, focusTarget ? focusTarget[1] : centerZ);
  }, [focusTarget, centerZ]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.lerp(desiredTarget.current, 0.08);
    controls.update();
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[radius * 0.7, radius * 0.68, centerZ + radius * 0.7]} fov={42} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={radius * 0.15}
        maxDistance={radius * 1.5}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.3}
      />
    </>
  );
}
