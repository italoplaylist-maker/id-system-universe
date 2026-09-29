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
      {/* The building is long and thin (a corridor of rooms), not round, so no single
          distance frames all of it AND keeps furniture legible — default lands on the
          Reception→Command Center core (the part that reads "this is a company" fastest),
          and maxDistance is generous enough to pull back for the full footprint. */}
      <PerspectiveCamera makeDefault position={[radius * 1.15, radius * 0.85, centerZ + radius * 1.15]} fov={38} near={0.1} far={radius * 8} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={radius * 0.18}
        maxDistance={radius * 2.4}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.4}
      />
    </>
  );
}
