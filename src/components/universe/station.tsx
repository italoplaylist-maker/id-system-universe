"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Text } from "@react-three/drei";
import * as THREE from "three";
import type { UniverseApplication } from "@/types/domain";

const STATUS_COLOR: Record<UniverseApplication["status"], string> = {
  RUNNING: "#34d399",
  STOPPED: "#4b5563",
  DEPLOYING: "#38bdf8",
  ERROR: "#f87171",
  UNKNOWN: "#8890a3",
};

interface StationProps {
  application: UniverseApplication;
  position: [number, number, number];
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * One application, rendered as a small platform with an emissive core. Status
 * changes color/intensity; DEPLOYING pulses. Memoized so a logs poll or an
 * unrelated application update elsewhere never re-renders every station.
 */
export const Station = memo(function Station({ application, position, selected, onSelect }: StationProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = STATUS_COLOR[application.status];
  const isDeploying = application.status === "DEPLOYING";
  const isError = application.status === "ERROR";
  const isRunning = application.status === "RUNNING";

  useFrame(({ clock }) => {
    if (!coreRef.current) return;
    const material = coreRef.current.material as THREE.MeshStandardMaterial;
    if (isDeploying) {
      material.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 5) * 0.6;
    } else if (isError) {
      material.emissiveIntensity = 0.9 + Math.sin(clock.elapsedTime * 3) * 0.5;
    } else if (isRunning) {
      material.emissiveIntensity = 0.55 + Math.sin(clock.elapsedTime * 1.2) * 0.1;
    } else {
      material.emissiveIntensity = 0.15;
    }
  });

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(application.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Base platform */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[0.55, 0.62, 0.1, 24]} />
        <meshStandardMaterial color="#14171f" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* Emissive core — swap point for a future GLTF station model. */}
      <mesh ref={coreRef} position={[0, 0.42, 0]} castShadow>
        <icosahedronGeometry args={[0.28, 1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.3} metalness={0.2} />
      </mesh>

      {(selected || hovered) && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.68, 0.78, 32]} />
          <meshBasicMaterial color={selected ? "#38bdf8" : "#ffffff"} transparent opacity={selected ? 0.9 : 0.4} />
        </mesh>
      )}

      <Text position={[0, 0.9, 0]} fontSize={0.16} color="#e6e9f0" anchorX="center" anchorY="bottom">
        {application.name}
      </Text>

      {hovered && (
        <Html position={[0, 1.15, 0]} center distanceFactor={8} occlude>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl">
            <p className="font-semibold text-foreground">{application.name}</p>
            <p className="text-muted">
              {application.status} · {application.providerName}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
});
