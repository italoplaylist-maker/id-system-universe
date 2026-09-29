"use client";

import type { RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { DigitalEmployee } from "./digital-employee";

/** The building's front door — a desk and a standing greeter, nothing operational happens here. */
export function ReceptionScene({ room }: { room: RoomLayout }) {
  return (
    <group position={[room.x, 0, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        <mesh position={[0, 0.4, -0.6]} castShadow>
          <boxGeometry args={[1.6, 0.8, 0.4]} />
          <meshStandardMaterial color="#181c24" roughness={0.5} />
        </mesh>
        <group position={[0, 0, -1.1]}>
          <DigitalEmployee accent={room.accent} />
        </group>
      </RoomShell>
    </group>
  );
}
