"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seededRandom } from "../assets/office-decor";

/** Cheap scrolling rain — one Points draw call, no per-drop objects. Deterministic starting
    layout (seeded, not Math.random()) so it's stable across renders. */
export function RainEffect({ center, radius, heavy }: { center: [number, number, number]; radius: number; heavy: boolean }) {
  const count = heavy ? 700 : 320;
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, velocities } = useMemo(() => {
    const rand = seededRandom(1337);
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * radius * 2.4;
      pos[i * 3 + 1] = rand() * 14;
      pos[i * 3 + 2] = (rand() - 0.5) * radius * 2.4;
      vel[i] = 6 + rand() * 4;
    }
    return { positions: pos, velocities: vel };
  }, [count, radius]);

  useFrame((_, delta) => {
    const geo = pointsRef.current?.geometry;
    const pos = geo?.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) - velocities[i] * delta;
      if (y < -0.2) y = 14;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} position={center}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#9fc4e8" size={0.05} transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}
