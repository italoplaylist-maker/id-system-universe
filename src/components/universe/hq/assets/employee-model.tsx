"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SCALE } from "../scale";

export type EmployeePose = "standing" | "seated" | "walking";
export type EmployeeActivity = "idle" | "working";

interface EmployeeModelProps {
  color?: string;
  accent?: string;
  pose?: EmployeePose;
  activity?: EmployeeActivity;
  seed?: number;
}

const H = SCALE.EMPLOYEE_HEIGHT; // 1.7 — every part below is a fraction of this, not a magic number
const LEG_LEN = H * 0.46;
const THIGH_LEN = LEG_LEN * 0.52;
const SHIN_LEN = LEG_LEN * 0.44;
const FOOT_LEN = LEG_LEN * 0.04;
const TORSO_LEN = H * 0.3;
const ARM_LEN = H * 0.24;
const UPPER_ARM_LEN = ARM_LEN * 0.52;
const FOREARM_LEN = ARM_LEN * 0.48;
const HEAD_SIZE = H * 0.12;

// Small, fixed wardrobes — picked deterministically from `seed`, never Math.random(), so
// the same employee looks the same on every render/refresh instead of reshuffling (briefing
// 38/39: variação por seed, não aleatória a cada render).
const SHIRTS = ["#3d4b5c", "#4a3d5c", "#3d5c48", "#5c3d3d", "#39424e", "#2d4a5c", "#5c4a2d"];
const PANTS = ["#232a33", "#2a2f3a", "#262b36", "#1f2a24"];
const SKIN_TONES = ["#e3b98f", "#8a5a3c", "#c68a5e", "#f0c9a0", "#a9754f"];
const HAIR_COLORS = ["#2b2320", "#4a3526", "#17171a", "#6b4a2f", "#8a8a8a"];

function pickFrom<T>(options: readonly T[], seed: number, salt: number): T {
  return options[Math.abs((seed + salt * 7919) % options.length)];
}

/**
 * Fallback digital employee: head / torso / upper-arm+forearm / thigh+shin, with hands and
 * feet closing off each limb — not a capsule or a stick figure. Wardrobe (shirt/pants/skin/
 * hair) is picked once from `seed`, so every employee reads as a distinct person instead of
 * identical clones. Swap point for a real rigged GLB later — see ASSETS.md.
 */
export function EmployeeModel({ color, accent = "#38bdf8", pose = "standing", activity = "idle", seed = 0 }: EmployeeModelProps) {
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);

  const shirt = color ?? pickFrom(SHIRTS, seed, 1);
  const pants = pickFrom(PANTS, seed, 2);
  const skin = pickFrom(SKIN_TONES, seed, 3);
  const hasHair = Math.abs((seed + 5 * 7919) % 5) !== 0; // ~80% have visible hair, rest read as bald/buzzed
  const hair = pickFrom(HAIR_COLORS, seed, 4);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 1.6 + seed;

    if (pose === "walking") {
      const swing = Math.sin(t * 2.2) * 0.55;
      if (leftLegRef.current) leftLegRef.current.rotation.x = swing;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -swing;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -swing * 0.7;
      if (rightArmRef.current) rightArmRef.current.rotation.x = swing * 0.7;
      if (bodyRef.current) bodyRef.current.position.y = Math.abs(Math.sin(t * 2.2)) * 0.02;
      return;
    }

    if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
    if (rightLegRef.current) rightLegRef.current.rotation.x = 0;

    if (activity === "working") {
      const type = Math.sin(t * 6) * 0.1;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -1.15 + type;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -1.15 - type;
    } else {
      // Natural idle: a slight constant elbow bend instead of ramrod-straight arms,
      // with a very small sway on top — avoids a T-pose/mannequin read when standing still.
      const idle = Math.sin(t * 0.8) * 0.04;
      if (leftArmRef.current) leftArmRef.current.rotation.x = 0.12 + idle;
      if (rightArmRef.current) rightArmRef.current.rotation.x = 0.12 - idle;
    }
    if (bodyRef.current) bodyRef.current.position.y = Math.sin(t * 0.9) * 0.01;
  });

  const seated = pose === "seated";
  const hipY = seated ? SCALE.CHAIR_HEIGHT - 0.06 : LEG_LEN;

  return (
    <group ref={bodyRef}>
      {/* legs, hip-mounted so the walk/seat rotation pivots correctly */}
      <group ref={leftLegRef} position={[-0.09, hipY, 0]} rotation={[seated ? -Math.PI / 2 : 0, 0, 0]}>
        <mesh position={[0, -THIGH_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.1, THIGH_LEN, 0.12]} />
          <meshStandardMaterial color={pants} roughness={0.75} />
        </mesh>
        {/* knee pivot */}
        <group position={[0, -THIGH_LEN, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
          <mesh position={[0, -SHIN_LEN / 2, 0]} castShadow>
            <boxGeometry args={[0.09, SHIN_LEN, 0.1]} />
            <meshStandardMaterial color={pants} roughness={0.75} />
          </mesh>
          <mesh position={[0, -SHIN_LEN - FOOT_LEN / 2, 0.025]} castShadow>
            <boxGeometry args={[0.095, FOOT_LEN, 0.16]} />
            <meshStandardMaterial color="#17191d" roughness={0.6} />
          </mesh>
        </group>
      </group>
      <group ref={rightLegRef} position={[0.09, hipY, 0]} rotation={[seated ? -Math.PI / 2 : 0, 0, 0]}>
        <mesh position={[0, -THIGH_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.1, THIGH_LEN, 0.12]} />
          <meshStandardMaterial color={pants} roughness={0.75} />
        </mesh>
        <group position={[0, -THIGH_LEN, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
          <mesh position={[0, -SHIN_LEN / 2, 0]} castShadow>
            <boxGeometry args={[0.09, SHIN_LEN, 0.1]} />
            <meshStandardMaterial color={pants} roughness={0.75} />
          </mesh>
          <mesh position={[0, -SHIN_LEN - FOOT_LEN / 2, 0.025]} castShadow>
            <boxGeometry args={[0.095, FOOT_LEN, 0.16]} />
            <meshStandardMaterial color="#17191d" roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* torso */}
      <mesh position={[0, hipY + TORSO_LEN / 2, 0]} castShadow>
        <boxGeometry args={[0.34, TORSO_LEN, 0.2]} />
        <meshStandardMaterial color={shirt} roughness={0.7} />
      </mesh>

      {/* arms, shoulder-mounted */}
      <group ref={leftArmRef} position={[-0.21, hipY + TORSO_LEN - 0.05, 0]}>
        <mesh position={[0, -UPPER_ARM_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.09, UPPER_ARM_LEN, 0.1]} />
          <meshStandardMaterial color={shirt} roughness={0.7} />
        </mesh>
        {/* elbow pivot */}
        <group position={[0, -UPPER_ARM_LEN, 0]}>
          <mesh position={[0, -FOREARM_LEN / 2, 0]} castShadow>
            <boxGeometry args={[0.08, FOREARM_LEN, 0.09]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
          <mesh position={[0, -FOREARM_LEN - 0.025, 0]} castShadow>
            <boxGeometry args={[0.075, 0.05, 0.08]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
        </group>
      </group>
      <group ref={rightArmRef} position={[0.21, hipY + TORSO_LEN - 0.05, 0]}>
        <mesh position={[0, -UPPER_ARM_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.09, UPPER_ARM_LEN, 0.1]} />
          <meshStandardMaterial color={shirt} roughness={0.7} />
        </mesh>
        <group position={[0, -UPPER_ARM_LEN, 0]}>
          <mesh position={[0, -FOREARM_LEN / 2, 0]} castShadow>
            <boxGeometry args={[0.08, FOREARM_LEN, 0.09]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
          <mesh position={[0, -FOREARM_LEN - 0.025, 0]} castShadow>
            <boxGeometry args={[0.075, 0.05, 0.08]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* head */}
      <mesh position={[0, hipY + TORSO_LEN + HEAD_SIZE / 2 + 0.02, 0]} castShadow>
        <boxGeometry args={[HEAD_SIZE, HEAD_SIZE, HEAD_SIZE]} />
        <meshStandardMaterial color={skin} roughness={0.55} />
      </mesh>
      {hasHair && (
        <mesh position={[0, hipY + TORSO_LEN + HEAD_SIZE + 0.015, -HEAD_SIZE * 0.08]} castShadow>
          <boxGeometry args={[HEAD_SIZE * 1.02, HEAD_SIZE * 0.32, HEAD_SIZE * 1.02]} />
          <meshStandardMaterial color={hair} roughness={0.8} />
        </mesh>
      )}
      {/* minimalist visor-style face — stylized, not an attempt at a realistic face */}
      <mesh position={[0, hipY + TORSO_LEN + HEAD_SIZE / 2 + 0.02, HEAD_SIZE / 2 + 0.001]}>
        <boxGeometry args={[HEAD_SIZE * 0.75, HEAD_SIZE * 0.28, 0.01]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
}
