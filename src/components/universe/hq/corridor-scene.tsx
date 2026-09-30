"use client";

import { WALL_HEIGHT, WALL_THICKNESS, type CorridorDoor, type CorridorFloor, type CorridorWallSegment } from "./hq-layout";

interface CorridorSceneProps {
  corridors: CorridorFloor[];
  walls: CorridorWallSegment[];
  doors: CorridorDoor[];
}

/** Every floor's walking spine: a real hallway enclosed by walls on both edges, with a
    door-width opening onto every room. One instance renders every floor at once — each
    wall/door segment already carries its own floor's y. */
export function CorridorScene({ corridors, walls, doors }: CorridorSceneProps) {
  return (
    <group>
      {corridors.map((corridor) => (
        <mesh key={corridor.y} position={[0, corridor.y, (corridor.minZ + corridor.maxZ) / 2]} receiveShadow>
          <boxGeometry args={[corridor.width, 0.08, corridor.maxZ - corridor.minZ]} />
          <meshStandardMaterial color="#28323f" roughness={1} metalness={0} />
        </mesh>
      ))}

      {walls.map((wall) => {
        const corridorWidth = corridors.find((c) => c.y === wall.y)?.width ?? 2.6;
        return (
          <mesh
            key={`${wall.side}-${wall.y}-${wall.z}`}
            position={[wall.side === "left" ? -corridorWidth / 2 : corridorWidth / 2, wall.y + WALL_HEIGHT / 2, wall.z]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, wall.length]} />
            <meshStandardMaterial color="#3a475a" roughness={0.8} metalness={0.05} />
          </mesh>
        );
      })}

      {/* Door threshold: a flat accent strip across the floor at the opening — reads clearly
          as "the door is here" from any angle, unlike free-standing thin vertical posts (tried
          first; from a shallow viewing angle their transparency blended into an ugly smear). */}
      {doors.map((door) => (
        <mesh key={`${door.side}-${door.y}-${door.z}`} position={[door.x, door.y + 0.03, door.z]}>
          <boxGeometry args={[0.14, 0.02, door.width]} />
          <meshBasicMaterial color={door.accent} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}
