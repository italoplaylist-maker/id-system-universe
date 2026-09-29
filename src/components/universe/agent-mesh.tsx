"use client";

import { forwardRef } from "react";
import * as THREE from "three";

/**
 * Low-poly primitive "operator" — box body, sphere head, small backpack.
 * Deliberately mechanical/neutral (no face), not a toy character. Swap point
 * for a future GLB/GLTF rig: replace the JSX below, keep the forwarded group ref.
 */
export const AgentMesh = forwardRef<THREE.Group, { color?: string }>(function AgentMesh({ color = "#c7ccda" }, ref) {
  return (
    <group ref={ref}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.16, 0.26, 0.11]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.46, 0]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#e6e9f0" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.28, -0.07]}>
        <boxGeometry args={[0.1, 0.14, 0.04]} />
        <meshStandardMaterial color="#0f1117" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[-0.11, 0.08, 0]} castShadow>
        <boxGeometry args={[0.05, 0.18, 0.05]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0.11, 0.08, 0]} castShadow>
        <boxGeometry args={[0.05, 0.18, 0.05]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
});
