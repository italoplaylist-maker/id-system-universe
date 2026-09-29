"use client";

import { forwardRef } from "react";
import * as THREE from "three";

/**
 * Low-poly digital operator: head, torso, arms, legs, a small visor detail —
 * no face, not a toy character. Built from primitives for V1; swap point for
 * a future GLB/GLTF rig (keep the forwarded group ref and the same silhouette).
 */
export const DigitalEmployee = forwardRef<THREE.Group, { color?: string; accent?: string }>(function DigitalEmployee(
  { color = "#c7ccda", accent = "#38bdf8" },
  ref,
) {
  return (
    <group ref={ref}>
      {/* legs */}
      <mesh position={[-0.09, 0.24, 0]} castShadow>
        <boxGeometry args={[0.11, 0.48, 0.14]} />
        <meshStandardMaterial color="#3a3f4b" roughness={0.7} />
      </mesh>
      <mesh position={[0.09, 0.24, 0]} castShadow>
        <boxGeometry args={[0.11, 0.48, 0.14]} />
        <meshStandardMaterial color="#3a3f4b" roughness={0.7} />
      </mesh>

      {/* torso */}
      <mesh position={[0, 0.66, 0]} castShadow>
        <boxGeometry args={[0.32, 0.36, 0.18]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.65} />
      </mesh>

      {/* arms */}
      <mesh position={[-0.21, 0.64, 0]} castShadow>
        <boxGeometry args={[0.09, 0.34, 0.1]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.65} />
      </mesh>
      <mesh position={[0.21, 0.64, 0]} castShadow>
        <boxGeometry args={[0.09, 0.34, 0.1]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.65} />
      </mesh>

      {/* head */}
      <mesh position={[0, 0.97, 0]} castShadow>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
        <meshStandardMaterial color="#e6e9f0" metalness={0.2} roughness={0.4} />
      </mesh>
      {/* visor — the one point of color/detail on an otherwise faceless head */}
      <mesh position={[0, 0.97, 0.101]}>
        <boxGeometry args={[0.15, 0.06, 0.01]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
});
