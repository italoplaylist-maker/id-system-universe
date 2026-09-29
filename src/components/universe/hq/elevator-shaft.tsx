"use client";

interface ElevatorShaftProps {
  x: number;
  z: number;
  topY: number;
  floorCount: number;
  floorHeight: number;
}

const SHAFT_WIDTH = 1.2;
const SHAFT_DEPTH = 1.2;

/**
 * The one vertical circulation core the building has, at a fixed (x,z) straight through
 * every floor — glass-and-frame walls plus a floor-indicator ring at each landing, so
 * climbing floors reads as "take the elevator up," not teleporting between disconnected
 * levels.
 */
export function ElevatorShaft({ x, z, topY, floorCount, floorHeight }: ElevatorShaftProps) {
  const corners: [number, number][] = [
    [-SHAFT_WIDTH / 2, -SHAFT_DEPTH / 2],
    [SHAFT_WIDTH / 2, -SHAFT_DEPTH / 2],
    [-SHAFT_WIDTH / 2, SHAFT_DEPTH / 2],
    [SHAFT_WIDTH / 2, SHAFT_DEPTH / 2],
  ];

  return (
    <group position={[x, 0, z]}>
      {corners.map(([cx, cz]) => (
        <mesh key={`${cx}-${cz}`} position={[cx, topY / 2, cz]}>
          <boxGeometry args={[0.08, topY, 0.08]} />
          <meshStandardMaterial color="#3a4256" metalness={0.3} roughness={0.6} />
        </mesh>
      ))}

      <mesh position={[0, topY / 2, -SHAFT_DEPTH / 2]}>
        <boxGeometry args={[SHAFT_WIDTH, topY, 0.03]} />
        <meshPhysicalMaterial color="#8fd8ff" transparent opacity={0.14} roughness={0.1} />
      </mesh>
      <mesh position={[0, topY / 2, SHAFT_DEPTH / 2]}>
        <boxGeometry args={[SHAFT_WIDTH, topY, 0.03]} />
        <meshPhysicalMaterial color="#8fd8ff" transparent opacity={0.14} roughness={0.1} />
      </mesh>

      {/* Floor-indicator ring at every landing, including the roof. */}
      {Array.from({ length: floorCount + 1 }).map((_, i) => (
        <mesh key={i} position={[0, i * floorHeight + 0.02, 0]}>
          <boxGeometry args={[SHAFT_WIDTH + 0.12, 0.03, SHAFT_DEPTH + 0.12]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
}
