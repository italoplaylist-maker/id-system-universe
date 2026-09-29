"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { DigitalEmployee } from "./digital-employee";

/** A couple of employees on standby — Operations is the spawn point every task agent walks out from. */
function StandbyEmployee({ offset }: { offset: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = Math.sin(clock.elapsedTime * 1.2 + offset) * 0.015;
  });
  return (
    <group ref={ref} position={[offset, 0, -0.6]}>
      <DigitalEmployee accent="#8890a3" />
    </group>
  );
}

export function OperationsScene({ room, activeCount }: { room: RoomLayout; activeCount: number }) {
  return (
    <group position={[room.x, 0, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        <mesh position={[0, 0.36, 0]} castShadow>
          <boxGeometry args={[room.width * 0.5, 0.05, 1]} />
          <meshStandardMaterial color="#181c24" roughness={0.5} />
        </mesh>
        {Math.max(0, 2 - activeCount) > 0 && <StandbyEmployee offset={-0.7} />}
        {Math.max(0, 1 - activeCount) > 0 && <StandbyEmployee offset={0.7} />}
      </RoomShell>
    </group>
  );
}
