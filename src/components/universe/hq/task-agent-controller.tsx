"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DigitalEmployee } from "./digital-employee";

export type TaskAgentState = "WORKING" | "DEPLOYING" | "WARNING" | "ERROR";

const STATE_COLOR: Record<TaskAgentState, string> = {
  WORKING: "#38bdf8",
  DEPLOYING: "#38bdf8",
  WARNING: "#fbbf24",
  ERROR: "#f87171",
};

const WALK_SPEED = 2.6; // world units / second

interface TaskAgentControllerProps {
  /** Door-to-door, wall-safe path from Operations to the resource's own workstation. */
  waypoints: [number, number][];
  state: TaskAgentState;
}

/**
 * Walks a DigitalEmployee along a precomputed corridor-safe path from
 * Operations to the busy resource's workstation, then works in place until
 * the parent unmounts it (the real operation resolved — this only ever
 * represents it, Coolify/the Control Plane decides the outcome). Never cuts
 * through a wall: every waypoint comes from buildCorridorPath, which only
 * routes through doors and the shared corridor spine.
 */
export function TaskAgentController({ waypoints, state }: TaskAgentControllerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const indexRef = useRef(0);
  const initialized = useRef(false);
  const color = STATE_COLOR[state];

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (!group || waypoints.length === 0) return;

    if (!initialized.current) {
      group.position.set(waypoints[0][0], 0, waypoints[0][1]);
      initialized.current = true;
    }

    const lastIndex = waypoints.length - 1;
    const targetIdx = Math.min(indexRef.current, lastIndex);
    const [tx, tz] = waypoints[targetIdx];
    const toTarget = new THREE.Vector3(tx - group.position.x, 0, tz - group.position.z);
    const distance = toTarget.length();

    if (targetIdx < lastIndex && distance < 0.15) {
      indexRef.current += 1;
      return;
    }

    if (targetIdx === lastIndex && distance < 0.05) {
      group.position.y = Math.sin(clock.elapsedTime * 4) * 0.03;
      group.rotation.y += delta * (state === "ERROR" || state === "WARNING" ? 0.6 : 1.4);
      return;
    }

    const step = Math.min(distance, WALK_SPEED * delta);
    toTarget.normalize();
    group.position.x += toTarget.x * step;
    group.position.z += toTarget.z * step;
    group.position.y = 0;
    group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  });

  return (
    <group ref={groupRef}>
      <DigitalEmployee accent={color} />
      <pointLight color={color} intensity={0.6} distance={1.4} position={[0, 0.4, 0]} />
    </group>
  );
}
