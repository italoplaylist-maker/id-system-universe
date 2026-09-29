"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AgentMesh } from "./agent-mesh";

interface AmbientAgentProps {
  center: [number, number];
  radius: number;
  speed: number;
  seed: number;
}

/**
 * Purely decorative wanderer — keeps an idle cluster feeling alive without
 * implying any real operation is happening there. Never spawned near a
 * station with an active TaskAgent state; see UniverseScene composition.
 */
export function AmbientAgent({ center, radius, speed, seed }: AmbientAgentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3());

  const pickTarget = useMemo(
    () => () => {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      target.current.set(center[0] + Math.cos(angle) * r, 0, center[1] + Math.sin(angle) * r);
    },
    [center, radius],
  );

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    if (group.position.lengthSq() === 0 && clock.elapsedTime < 0.1) {
      group.position.set(center[0], 0, center[1]);
    }
    if (target.current.lengthSq() === 0) pickTarget();

    const distance = group.position.distanceTo(target.current);
    if (distance < 0.1) {
      pickTarget();
    } else {
      group.lookAt(target.current.x, 0, target.current.z);
      group.position.x += (target.current.x - group.position.x) * speed * 0.02;
      group.position.z += (target.current.z - group.position.z) * speed * 0.02;
      group.position.y = Math.abs(Math.sin(clock.elapsedTime * 6 + seed)) * 0.04;
    }
  });

  return (
    <group ref={groupRef} position={[center[0], 0, center[1]]}>
      <AgentMesh color="#8890a3" />
    </group>
  );
}
