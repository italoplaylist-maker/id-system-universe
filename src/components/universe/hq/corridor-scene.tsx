"use client";

import { WALL_HEIGHT, WALL_THICKNESS, type CorridorDoor, type CorridorLayout, type CorridorWallSegment } from "./hq-layout";

interface CorridorSceneProps {
  corridor: CorridorLayout;
  walls: CorridorWallSegment[];
  doors: CorridorDoor[];
}

/** The shared walking spine: a real hallway now — enclosed by walls on both edges, with a door-width opening onto every room. */
export function CorridorScene({ corridor, walls, doors }: CorridorSceneProps) {
  const halfWidth = corridor.width / 2;

  return (
    <group>
      <mesh position={[0, 0, corridor.length / 2]} receiveShadow>
        <boxGeometry args={[corridor.width, 0.08, corridor.length]} />
        <meshStandardMaterial color="#1c212c" roughness={1} metalness={0} />
      </mesh>

      {walls.map((wall) => (
        <mesh
          key={`${wall.side}-${wall.z}`}
          position={[wall.side === "left" ? -halfWidth : halfWidth, WALL_HEIGHT / 2, wall.z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, wall.length]} />
          <meshStandardMaterial color="#262c3a" roughness={0.8} metalness={0.05} />
        </mesh>
      ))}

      {/* Door frame: two accent posts at the opening's edges plus a lintel bar above — the
          "you're entering a room" cue a bare gap in the wall doesn't give on its own. */}
      {doors.map((door) => (
        <group key={`${door.side}-${door.z}`}>
          <mesh position={[door.x, WALL_HEIGHT / 2, door.z - door.width / 2]}>
            <boxGeometry args={[0.1, WALL_HEIGHT, 0.1]} />
            <meshBasicMaterial color={door.accent} transparent opacity={0.85} />
          </mesh>
          <mesh position={[door.x, WALL_HEIGHT / 2, door.z + door.width / 2]}>
            <boxGeometry args={[0.1, WALL_HEIGHT, 0.1]} />
            <meshBasicMaterial color={door.accent} transparent opacity={0.85} />
          </mesh>
          <mesh position={[door.x, WALL_HEIGHT + 0.02, door.z]}>
            <boxGeometry args={[0.08, 0.04, door.width]} />
            <meshBasicMaterial color={door.accent} transparent opacity={0.65} />
          </mesh>
          <mesh position={[door.x, 0.03, door.z]}>
            <boxGeometry args={[0.1, 0.02, door.width]} />
            <meshBasicMaterial color={door.accent} transparent opacity={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
