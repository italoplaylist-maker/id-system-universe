"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { EmployeeModel } from "./assets/employee-model";

export type TaskAgentState = "WORKING" | "DEPLOYING" | "WARNING" | "ERROR";

const STATE_COLOR: Record<TaskAgentState, string> = {
  WORKING: "#38bdf8",
  DEPLOYING: "#38bdf8",
  WARNING: "#fbbf24",
  ERROR: "#f87171",
};

const WALK_SPEED = 2.6; // world units / second

interface TaskAgentControllerProps {
  /** Door-to-door, wall-safe path from Operations to the resource's own workstation —
      including a vertical leg through the elevator core when it crosses floors. */
  waypoints: [number, number, number][];
  state: TaskAgentState;
}

/**
 * Walks an EmployeeModel along a precomputed corridor-safe path from
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
  const [arrived, setArrived] = useState(false);
  const color = STATE_COLOR[state];

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || waypoints.length === 0) return;

    if (!initialized.current) {
      group.position.set(waypoints[0][0], waypoints[0][1], waypoints[0][2]);
      initialized.current = true;
    }

    const lastIndex = waypoints.length - 1;
    const targetIdx = Math.min(indexRef.current, lastIndex);
    const [tx, ty, tz] = waypoints[targetIdx];
    const toTarget = new THREE.Vector3(tx - group.position.x, ty - group.position.y, tz - group.position.z);
    const distance = toTarget.length();

    if (targetIdx < lastIndex && distance < 0.15) {
      indexRef.current += 1;
      return;
    }

    if (targetIdx === lastIndex && distance < 0.05) {
      if (!arrived) setArrived(true);
      return;
    }

    const step = Math.min(distance, WALK_SPEED * delta);
    toTarget.normalize();
    group.position.x += toTarget.x * step;
    group.position.y += toTarget.y * step;
    group.position.z += toTarget.z * step;
    // Riding the elevator is a near-vertical leg (toTarget.x/z ~ 0) — keep facing the
    // last horizontal heading instead of snapping to atan2(0, 0).
    if (Math.abs(toTarget.x) > 0.001 || Math.abs(toTarget.z) > 0.001) {
      group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    }
  });

  return (
    <group ref={groupRef}>
      <EmployeeModel accent={color} pose={arrived ? "standing" : "walking"} activity={arrived ? "working" : "idle"} />
      <pointLight color={color} intensity={0.6} distance={1.4} position={[0, 0.4, 0]} />
    </group>
  );
}
