"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { UniverseApplication } from "@/types/domain";

const STATUS_COLOR: Record<UniverseApplication["status"], string> = {
  RUNNING: "#34d399",
  STOPPED: "#3a3f4b",
  DEPLOYING: "#38bdf8",
  ERROR: "#f87171",
  UNKNOWN: "#8890a3",
};

interface ResourceWorkstationProps {
  resource: UniverseApplication;
  position: [number, number, number];
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * A desk + monitor standing in for one resource. Memoized so a logs poll or
 * an unrelated resource's status change never re-renders every desk in the
 * building — only the one whose status actually changed re-runs useFrame math.
 */
export const ResourceWorkstation = memo(function ResourceWorkstation({ resource, position, selected, onSelect }: ResourceWorkstationProps) {
  const screenRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = STATUS_COLOR[resource.status];
  const isDeploying = resource.status === "DEPLOYING";
  const isError = resource.status === "ERROR";
  const isStopped = resource.status === "STOPPED";
  const isDatabase = resource.resourceType === "DATABASE";

  useFrame(({ clock }) => {
    const material = screenRef.current?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) return;
    if (isDeploying) material.emissiveIntensity = 1.1 + Math.sin(clock.elapsedTime * 5) * 0.5;
    else if (isError) material.emissiveIntensity = 0.85 + Math.sin(clock.elapsedTime * 3) * 0.45;
    else if (isStopped) material.emissiveIntensity = 0.05;
    else material.emissiveIntensity = 0.5 + Math.sin(clock.elapsedTime * 1.1) * 0.08;
  });

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(resource.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.5, 24]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
        </mesh>
      )}

      {isDatabase ? (
        // Databases read as a small server tower rather than a desk+monitor.
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[0.32, 0.7, 0.32]} />
          <meshStandardMaterial color="#20242f" metalness={0.4} roughness={0.5} />
        </mesh>
      ) : (
        <>
          {/* desk */}
          <mesh position={[0, 0.36, 0]} castShadow>
            <boxGeometry args={[0.7, 0.04, 0.4]} />
            <meshStandardMaterial color="#2a2e38" roughness={0.6} />
          </mesh>
          <mesh position={[-0.3, 0.18, 0.15]}>
            <boxGeometry args={[0.03, 0.36, 0.03]} />
            <meshStandardMaterial color="#1a1d24" />
          </mesh>
          <mesh position={[0.3, 0.18, 0.15]}>
            <boxGeometry args={[0.03, 0.36, 0.03]} />
            <meshStandardMaterial color="#1a1d24" />
          </mesh>
          {/* monitor */}
          <mesh position={[0, 0.58, -0.1]}>
            <boxGeometry args={[0.32, 0.2, 0.02]} />
            <meshStandardMaterial color="#14161c" />
          </mesh>
          <mesh ref={screenRef} position={[0, 0.58, -0.089]}>
            <planeGeometry args={[0.28, 0.16]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
          </mesh>
          {/* chair */}
          <mesh position={[0, 0.22, 0.32]}>
            <boxGeometry args={[0.28, 0.04, 0.28]} />
            <meshStandardMaterial color="#3a3f4b" />
          </mesh>
        </>
      )}

      {isDatabase && (
        <mesh ref={screenRef} position={[0, 0.35, 0.161]}>
          <planeGeometry args={[0.1, 0.1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
        </mesh>
      )}

      <Html position={[0, isDatabase ? 0.78 : 0.72, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: 11, color: "#e6e9f0", fontFamily: "ui-sans-serif, system-ui", whiteSpace: "nowrap" }}>{resource.name}</span>
      </Html>

      {hovered && (
        <Html position={[0, isDatabase ? 1.0 : 0.95, 0]} center distanceFactor={7} occlude>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl">
            <p className="font-semibold text-foreground">{resource.name}</p>
            <p className="text-muted">
              {resource.status} · {resource.providerName}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
});
