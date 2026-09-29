"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { EmployeeModel } from "./assets/employee-model";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { DeskFallback, ChairFallback, MonitorFallback } from "./assets/procedural-furniture";

const DESK_POSITIONS: [number, number][] = [
  [-1.8, -0.7],
  [-0.6, -0.7],
  [0.6, -0.7],
  [1.8, -0.7],
];

function OpsDesk({ x, z, manned }: { x: number; z: number; manned: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <WorldAsset asset={ASSET_KEYS.OFFICE_DESK} fallback={<DeskFallback />} />
      <WorldAsset asset={ASSET_KEYS.MONITOR} fallback={<MonitorFallback color="#8890a3" pulse="none" />} />
      <WorldAsset asset={ASSET_KEYS.OFFICE_CHAIR} fallback={<ChairFallback />} position={[0, 0, 0.32]} />
      {manned && (
        <group position={[0, 0, 0.32]}>
          <StandbyEmployee />
        </group>
      )}
    </group>
  );
}

/** A standby employee at an Operations desk — this is the pool every task agent conceptually walks out from. */
function StandbyEmployee() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = Math.sin(clock.elapsedTime * 1.2) * 0.01;
  });
  return (
    <group ref={ref}>
      <EmployeeModel accent="#8890a3" pose="seated" activity="working" />
    </group>
  );
}

export function OperationsScene({ room, activeCount }: { room: RoomLayout; activeCount: number }) {
  return (
    <group position={[room.x, 0, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        {DESK_POSITIONS.map(([x, z], i) => (
          <OpsDesk key={i} x={x} z={z} manned={i < Math.max(1, 2 - activeCount)} />
        ))}
      </RoomShell>
    </group>
  );
}
