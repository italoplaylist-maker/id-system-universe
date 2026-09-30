"use client";

/** A real window: an actual gap in the wall (see room-shell.tsx's southWindow split),
    a frame, a sill, light glass, and corporate blinds — not a blue plane stuck on a wall. */
export function WindowGlass({ width, height }: { width: number; height: number }) {
  return (
    <group>
      {/* Frame */}
      <mesh>
        <boxGeometry args={[width + 0.06, height + 0.06, 0.05]} />
        <meshStandardMaterial color="#20262f" roughness={0.6} metalness={0.15} />
      </mesh>
      {/* Sill */}
      <mesh position={[0, -height / 2 - 0.03, 0.05]}>
        <boxGeometry args={[width + 0.14, 0.03, 0.12]} />
        <meshStandardMaterial color="#2a323e" roughness={0.6} />
      </mesh>
      {/* Glass — light transparency, a hint of reflection, no mirror/heavy refraction. */}
      <mesh position={[0, 0, 0.015]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#bcd7ff" transparent opacity={0.22} roughness={0.12} metalness={0.2} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Corporate horizontal blinds — simple low-poly slats, no cloth simulation. `openFraction`
    is how much of the window height is left clear (spec: ~60-80% open by default). */
export function Blinds({ width, height, openFraction }: { width: number; height: number; openFraction: number }) {
  const slatCount = 12;
  const closedCount = Math.round(slatCount * (1 - openFraction));
  const slatHeight = height / slatCount;
  return (
    <group position={[0, height / 2, 0.03]}>
      {Array.from({ length: closedCount }).map((_, i) => (
        <mesh key={i} position={[0, -slatHeight * (i + 0.5), 0]}>
          <boxGeometry args={[width * 0.98, slatHeight * 0.88, 0.012]} />
          <meshStandardMaterial color="#c7cdd8" roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}
