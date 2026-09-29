"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

interface HqCameraProps {
  radius: number;
  centerX: number;
  centerZ: number;
  /** World x,z of the room to focus on, or null to return to the overview shot. */
  focusTarget: [number, number] | null;
}

// Same relative direction as the default overview shot (see PerspectiveCamera
// position below) — focusing a room keeps the isometric viewing angle and
// just flies closer along it, instead of cutting to a different angle.
const VIEW_DIRECTION = new THREE.Vector3(1.05, 0.8, 1.05).normalize();

function overviewShot(centerX: number, centerZ: number, radius: number) {
  return {
    target: new THREE.Vector3(centerX, 0, centerZ),
    position: new THREE.Vector3(centerX + radius * 1.05, radius * 0.8, centerZ + radius * 1.05),
  };
}

function focusShot(focusTarget: [number, number], radius: number) {
  const distance = Math.max(radius * 0.35, 3.5);
  const target = new THREE.Vector3(focusTarget[0], 0.6, focusTarget[1]);
  const position = target.clone().addScaledVector(VIEW_DIRECTION, distance);
  return { target, position };
}

/**
 * Isometric-leaning camera over the whole building by default, with a smooth
 * flight toward a room when one is focused (spec: "double click: câmera
 * aproxima" — a real dolly-in, not just a re-aimed orbit target — and
 * "câmera nunca teleporta bruscamente"). Position/distance derive from the
 * layout's real bounds (`radius`, `centerX/centerZ` — see
 * calculateWorldBounds in hq-layout.ts), not a constant tuned for one
 * specific project count, so 4 projects and 20 projects both get a sensible
 * default framing. Once the flight settles, OrbitControls takes back full
 * control of position (so the user can freely orbit/zoom the focused room)
 * — only the `target` keeps tracking the focus so it doesn't need to be
 * re-triggered by further user input.
 */
export function HqCamera({ radius, centerX, centerZ, focusTarget }: HqCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const desiredTarget = useRef(new THREE.Vector3(centerX, 0, centerZ));
  const desiredPosition = useRef(new THREE.Vector3());
  const flying = useRef(false);

  useEffect(() => {
    const shot = focusTarget ? focusShot(focusTarget, radius) : overviewShot(centerX, centerZ, radius);
    desiredTarget.current.copy(shot.target);
    desiredPosition.current.copy(shot.position);
    flying.current = true;
  }, [focusTarget, centerX, centerZ, radius]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.lerp(desiredTarget.current, 0.08);
    if (flying.current) {
      controls.object.position.lerp(desiredPosition.current, 0.08);
      if (controls.object.position.distanceTo(desiredPosition.current) < 0.05) {
        flying.current = false;
      }
    }
    controls.update();
  });

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={[centerX + radius * 1.05, radius * 0.8, centerZ + radius * 1.05]}
        fov={38}
        near={0.1}
        far={radius * 8}
      />
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
