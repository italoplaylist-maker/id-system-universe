"use client";

import type { CorridorLayout } from "./hq-layout";

/** The shared spine every room opens onto — a plain floor strip, deliberately not the visual protagonist. */
export function CorridorScene({ corridor }: { corridor: CorridorLayout }) {
  return (
    <mesh position={[0, 0, corridor.length / 2]} receiveShadow>
      <boxGeometry args={[corridor.width, 0.08, corridor.length]} />
      <meshStandardMaterial color="#1c212c" roughness={1} metalness={0} />
    </mesh>
  );
}
