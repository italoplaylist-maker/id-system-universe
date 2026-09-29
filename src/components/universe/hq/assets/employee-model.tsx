"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PALETTE } from "../palette";
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
const LEG_LEN = H * 0.28;
const THIGH_LEN = LEG_LEN * 0.52;
const SHIN_LEN = LEG_LEN * 0.48;
const TORSO_LEN = H * 0.32;
const ARM_LEN = H * 0.26;
const UPPER_ARM_LEN = ARM_LEN * 0.5;
const FOREARM_LEN = ARM_LEN * 0.5;
const HEAD_SIZE = H * 0.13;

/**
 * Fallback digital employee: head / torso / upper-arm+forearm / thigh+shin,
 * not a capsule or a stick figure (briefing "employee fallback"). Swap point
 * for a real rigged GLB later — see ASSETS.md (EMPLOYEE_STANDARD/ALT).
 */
export function EmployeeModel({ color = PALETTE.uniform, accent = "#38bdf8", pose = "standing", activity = "idle", seed = 0 }: EmployeeModelProps) {
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);

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
      const type = Math.sin(t * 6) * 0.12;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -1.15 + type;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -1.15 - type;
    } else {
      const idle = Math.sin(t * 0.8) * 0.04;
      if (leftArmRef.current) leftArmRef.current.rotation.x = idle;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -idle;
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
          <meshStandardMaterial color={PALETTE.uniformAlt} roughness={0.7} />
        </mesh>
        <group position={[0, -THIGH_LEN, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
          <mesh position={[0, -SHIN_LEN / 2, 0]} castShadow>
            <boxGeometry args={[0.09, SHIN_LEN, 0.1]} />
            <meshStandardMaterial color="#232a33" roughness={0.7} />
          </mesh>
        </group>
      </group>
      <group ref={rightLegRef} position={[0.09, hipY, 0]} rotation={[seated ? -Math.PI / 2 : 0, 0, 0]}>
        <mesh position={[0, -THIGH_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.1, THIGH_LEN, 0.12]} />
          <meshStandardMaterial color={PALETTE.uniformAlt} roughness={0.7} />
        </mesh>
        <group position={[0, -THIGH_LEN, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
          <mesh position={[0, -SHIN_LEN / 2, 0]} castShadow>
            <boxGeometry args={[0.09, SHIN_LEN, 0.1]} />
            <meshStandardMaterial color="#232a33" roughness={0.7} />
          </mesh>
        </group>
      </group>

      {/* torso */}
      <mesh position={[0, hipY + TORSO_LEN / 2, 0]} castShadow>
        <boxGeometry args={[0.34, TORSO_LEN, 0.2]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>

      {/* arms, shoulder-mounted */}
      <group ref={leftArmRef} position={[-0.21, hipY + TORSO_LEN - 0.05, 0]}>
        <mesh position={[0, -UPPER_ARM_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.09, UPPER_ARM_LEN, 0.1]} />
          <meshStandardMaterial color={color} roughness={0.65} />
        </mesh>
        <mesh position={[0, -UPPER_ARM_LEN - FOREARM_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.08, FOREARM_LEN, 0.09]} />
          <meshStandardMaterial color={PALETTE.skin} roughness={0.6} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.21, hipY + TORSO_LEN - 0.05, 0]}>
        <mesh position={[0, -UPPER_ARM_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.09, UPPER_ARM_LEN, 0.1]} />
          <meshStandardMaterial color={color} roughness={0.65} />
        </mesh>
        <mesh position={[0, -UPPER_ARM_LEN - FOREARM_LEN / 2, 0]} castShadow>
          <boxGeometry args={[0.08, FOREARM_LEN, 0.09]} />
          <meshStandardMaterial color={PALETTE.skin} roughness={0.6} />
        </mesh>
      </group>

      {/* head */}
      <mesh position={[0, hipY + TORSO_LEN + HEAD_SIZE / 2 + 0.02, 0]} castShadow>
        <boxGeometry args={[HEAD_SIZE, HEAD_SIZE, HEAD_SIZE]} />
        <meshStandardMaterial color={PALETTE.skin} roughness={0.55} />
      </mesh>
      <mesh position={[0, hipY + TORSO_LEN + HEAD_SIZE / 2 + 0.02, HEAD_SIZE / 2 + 0.001]}>
        <boxGeometry args={[HEAD_SIZE * 0.75, HEAD_SIZE * 0.28, 0.01]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
}
