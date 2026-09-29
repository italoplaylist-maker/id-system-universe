"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AgentMesh } from "./agent-mesh";

export type TaskAgentState = "WALKING" | "WORKING" | "DEPLOYING" | "WARNING" | "ERROR";

const STATE_COLOR: Record<TaskAgentState, string> = {
  WALKING: "#c7ccda",
  WORKING: "#38bdf8",
  DEPLOYING: "#38bdf8",
  WARNING: "#fbbf24",
  ERROR: "#f87171",
};

interface TaskAgentProps {
  targetPosition: [number, number, number];
  state: TaskAgentState;
}

/**
 * One agent assigned to one busy/errored station. Walks in from a spawn ring,
 * then bobs/spins in place while the operation is running. Identity (via the
 * parent's `key={applicationId}`) is what makes this feel continuous across
 * polling refreshes instead of popping in and out.
 */
export function TaskAgent({ targetPosition, state }: TaskAgentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const spawned = useRef(false);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const target = new THREE.Vector3(targetPosition[0] + 0.9, 0, targetPosition[2] + 0.9);

    if (!spawned.current) {
      group.position.set(target.x + 2.5, 0, target.z + 2.5);
      spawned.current = true;
    }

    group.position.x += (target.x - group.position.x) * 0.05;
    group.position.z += (target.z - group.position.z) * 0.05;

    const arrived = group.position.distanceTo(target) < 0.15;
    if (arrived && state !== "WALKING") {
      group.position.y = Math.sin(clock.elapsedTime * 4) * 0.03;
      group.rotation.y = clock.elapsedTime * (state === "ERROR" || state === "WARNING" ? 0.6 : 1.4);
    } else {
      group.lookAt(target.x, 0, target.z);
    }
  });

  return (
    <group ref={groupRef}>
      <AgentMesh color={STATE_COLOR[state]} />
      <pointLight color={STATE_COLOR[state]} intensity={state === "WALKING" ? 0 : 0.6} distance={1.2} position={[0, 0.4, 0]} />
    </group>
  );
}
