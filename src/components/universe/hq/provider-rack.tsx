"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { UniverseProviderSummary } from "@/types/domain";

const HEALTH_COLOR: Record<UniverseProviderSummary["health"], string> = {
  ONLINE: "#34d399",
  DEGRADED: "#fbbf24",
  OFFLINE: "#f87171",
  UNKNOWN: "#8890a3",
};

const RACK_WIDTH = 1.1;
const RACK_DEPTH = 0.9;
const RACK_HEIGHT = 1.9;

interface ProviderRackProps {
  provider: UniverseProviderSummary;
  position: [number, number];
  selected: boolean;
  onSelect: (id: string) => void;
}

/** One physical rack per InfrastructureProvider — the server room never has more or fewer racks than configured providers. */
export const ProviderRack = memo(function ProviderRack({ provider, position, selected, onSelect }: ProviderRackProps) {
  const ledRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = HEALTH_COLOR[provider.health];
  const pulsing = provider.health === "ONLINE" || provider.health === "DEGRADED";

  useFrame(({ clock }) => {
    const material = ledRef.current?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) return;
    material.emissiveIntensity = pulsing ? 0.6 + Math.sin(clock.elapsedTime * (provider.health === "DEGRADED" ? 4 : 1.5)) * 0.4 : 0.1;
  });

  const unitCount = 6;

  return (
    <group
      position={[position[0], 0, position[1]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(provider.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.75, 0.85, 24]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
        </mesh>
      )}

      <mesh position={[0, RACK_HEIGHT / 2, 0]} castShadow>
        <boxGeometry args={[RACK_WIDTH, RACK_HEIGHT, RACK_DEPTH]} />
        <meshStandardMaterial color="#1a1d24" metalness={0.6} roughness={0.35} />
      </mesh>

      {Array.from({ length: unitCount }).map((_, i) => (
        <mesh key={i} position={[0, 0.22 + i * (RACK_HEIGHT / unitCount), RACK_DEPTH / 2 + 0.001]}>
          <planeGeometry args={[RACK_WIDTH - 0.12, RACK_HEIGHT / unitCount - 0.04]} />
          <meshStandardMaterial color="#0d0f14" roughness={0.7} />
        </mesh>
      ))}

      <mesh ref={ledRef} position={[RACK_WIDTH / 2 - 0.08, RACK_HEIGHT - 0.15, RACK_DEPTH / 2 + 0.01]}>
        <circleGeometry args={[0.04, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>

      <Html position={[0, RACK_HEIGHT + 0.16, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: 11, color: "#e6e9f0", fontFamily: "ui-sans-serif, system-ui", whiteSpace: "nowrap" }}>{provider.name}</span>
      </Html>

      {hovered && (
        <Html position={[0, RACK_HEIGHT + 0.4, 0]} center distanceFactor={7} occlude>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl">
            <p className="font-semibold text-foreground">{provider.name}</p>
            <p className="text-muted">
              {provider.health} · {provider.applicationCount} resources
            </p>
          </div>
        </Html>
      )}
    </group>
  );
});
