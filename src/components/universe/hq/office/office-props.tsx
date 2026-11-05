"use client";

import { RoundedBox } from "@react-three/drei";
import { WorldAsset } from "../assets/world-asset";
import { ASSET_KEYS } from "../assets/asset-keys";
import { PlantFallback } from "../assets/procedural-furniture";
import { PALETTE } from "../palette";
import { OFFICE, type OfficeLayout } from "./office-layout";
import { rectObstacle, type Obstacle } from "../life/geometry";

/** A tall indoor tree: trunk + layered leaf clusters in a stone planter. */
export function TallPlant({ scale = 1 }: { scale?: number }) {
  const leaves: [number, number, number][] = [
    [0, 1.5, 0],
    [0.22, 1.25, 0.1],
    [-0.2, 1.3, -0.1],
    [0.1, 1.7, -0.12],
    [-0.12, 1.1, 0.16],
    [0.2, 1.05, -0.15],
  ];
  return (
    <group scale={scale}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.19, 0.4, 20]} />
        <meshStandardMaterial color="#d8d4cb" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <cylinderGeometry args={[0.21, 0.21, 0.02, 20]} />
        <meshStandardMaterial color="#2a1f17" roughness={1} />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.04, 1.0, 8]} />
        <meshStandardMaterial color="#5a4330" roughness={0.9} />
      </mesh>
      {leaves.map((p, i) => (
        <mesh key={i} position={p} scale={[1.2, 0.9, 1.2]} castShadow>
          <icosahedronGeometry args={[0.24, 1]} />
          <meshStandardMaterial color={i % 2 ? "#3a8a57" : "#2f7a4c"} roughness={0.75} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Reception({ accent }: { accent: string }) {
  return (
    <group>
      <RoundedBox args={[3.0, 1.05, 0.7]} radius={0.04} smoothness={3} position={[0, 0.525, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e9e6df" roughness={0.6} />
      </RoundedBox>
      {Array.from({ length: 14 }).map((_, i) => (
        <mesh key={i} position={[-1.35 + i * 0.208, 0.5, 0.355]}>
          <boxGeometry args={[0.1, 0.9, 0.03]} />
          <meshStandardMaterial color={i % 2 ? "#7a5639" : "#6d4c34"} roughness={0.7} />
        </mesh>
      ))}
      <RoundedBox args={[3.1, 0.05, 0.8]} radius={0.02} smoothness={3} position={[0, 1.07, 0]} castShadow>
        <meshStandardMaterial color="#1b1e25" roughness={0.4} metalness={0.3} />
      </RoundedBox>
      <mesh position={[0, 1.4, -0.05]}>
        <boxGeometry args={[1.2, 0.22, 0.03]} />
        <meshStandardMaterial color="#0b0d12" emissive={PALETTE.brand} emissiveIntensity={0.55} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.98, 0.37]}>
        <boxGeometry args={[2.9, 0.025, 0.015]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

function Bookshelf({ width = 1.6 }: { width?: number }) {
  const colors = ["#c8553d", "#3d6fb3", "#d9d3c5", "#2f7a4c", "#8a6a3c", "#5b4b8a"];
  return (
    <group>
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[width, 2.0, 0.34]} />
        <meshStandardMaterial color="#b99a76" roughness={0.7} />
      </mesh>
      {[0.2, 0.7, 1.2, 1.7].map((y, r) => (
        <group key={y} position={[0, y, 0.03]}>
          <mesh>
            <boxGeometry args={[width - 0.08, 0.4, 0.28]} />
            <meshStandardMaterial color="#efe9dc" roughness={0.9} />
          </mesh>
          {Array.from({ length: Math.round(width / 0.12) }).map((_, i) => (
            <mesh key={i} position={[-width / 2 + 0.1 + i * 0.11, -0.04, 0.02]}>
              <boxGeometry args={[0.07, 0.26 + ((i * 7 + r * 3) % 4) * 0.025, 0.2]} />
              <meshStandardMaterial color={colors[(i + r) % colors.length]} roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Reception, lounge, bookshelves and plants — dressing for the open front and the sides of the screen. */
export function OfficeProps({ layout }: { layout: OfficeLayout }) {
  const { width, depth, screen } = layout;
  const frontZ = depth / 2;
  const backZ = -depth / 2;
  const rightOfScreenX = (width / 2 + screen.width / 2) / 2;
  return (
    <group>
      {/* reception, front-left */}
      <group position={[-width / 2 + 3.2, 0, frontZ - 1.5]}>
        <Reception accent={PALETTE.brand} />
      </group>
      <WorldAsset asset={ASSET_KEYS.PLANT} fallback={<TallPlant scale={1.05} />} position={[-width / 2 + 1.1, 0, frontZ - 1.2]} />

      <group position={[width / 2 - 0.9, 0, frontZ - 1.0]}>
        <TallPlant scale={1.2} />
      </group>

      {/* back wall, right of the screen: shelves, plant, clock */}
      <group position={[rightOfScreenX + 0.4, 0, backZ + 0.35]}>
        <Bookshelf width={Math.min(2.4, width / 2 - screen.width / 2 - 1.6)} />
      </group>
      <group position={[width / 2 - 0.8, 0, backZ + 0.8]}>
        <TallPlant scale={1.15} />
      </group>
      {/* tall plant between the racks and the screen */}
      <group position={[-screen.width / 2 - 0.5, 0, backZ + 0.6]}>
        <PlantFallback />
      </group>

      {/* floor accent: a brand-red inlay line down the walkway */}
      <mesh position={[0, 0.011, backZ + OFFICE.BACK_ZONE - 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width - 1.2, 0.05]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

/** Onde a decoração fixa do escritório (recepção, lounge pequeno, estante, plantas, racks) bloqueia o caminho dos personagens. */
export function officePropObstacles(layout: OfficeLayout): Obstacle[] {
  const { width, depth, screen } = layout;
  const frontZ = depth / 2;
  const backZ = -depth / 2;
  const rightOfScreenX = (width / 2 + screen.width / 2) / 2;
  const circle = (cx: number, cz: number, r: number, label: string): Obstacle => ({ kind: "circle", cx, cz, r, label });
  return [
    rectObstacle(-width / 2 + 3.2, frontZ - 1.5, 1.55, 0.4, "reception"),
    circle(-width / 2 + 1.1, frontZ - 1.2, 0.35, "plant"),
    circle(width / 2 - 0.9, frontZ - 1.0, 0.4, "plant"),
    rectObstacle(rightOfScreenX + 0.4, backZ + 0.35, Math.min(2.4, width / 2 - screen.width / 2 - 1.6) / 2, 0.2, "bookshelf"),
    circle(width / 2 - 0.8, backZ + 0.8, 0.4, "plant"),
    circle(-screen.width / 2 - 0.5, backZ + 0.6, 0.35, "plant"),
    ...layout.racks.map((r) => circle(r.x, r.z, 0.5, "rack")),
  ];
}
