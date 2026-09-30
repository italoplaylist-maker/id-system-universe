"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PALETTE } from "../palette";
import { SCALE } from "../scale";

/**
 * Placeholder-quality, not final-quality: these exist so layout, scale,
 * interaction and animation states can be built and validated before real
 * GLBs land (see ASSETS.md). Each still has the named parts a real model
 * would have — a desk isn't one box, a person isn't one capsule — so the
 * composition reads as furniture even before the swap.
 */

export function DeskFallback() {
  const legXs = [-0.32, 0.32];
  const legZs = [-0.16, 0.16];
  return (
    <group>
      <mesh position={[0, SCALE.DESK_HEIGHT, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.035, 0.42]} />
        <meshStandardMaterial color={PALETTE.furniture} roughness={0.75} />
      </mesh>
      {legXs.flatMap((x) =>
        legZs.map((z) => (
          <mesh key={`${x}-${z}`} position={[x, SCALE.DESK_HEIGHT / 2, z]} castShadow>
            <boxGeometry args={[0.03, SCALE.DESK_HEIGHT, 0.03]} />
            <meshStandardMaterial color={PALETTE.metalDark} metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      {/* keyboard */}
      <mesh position={[0, SCALE.DESK_HEIGHT + 0.02, 0.1]}>
        <boxGeometry args={[0.24, 0.015, 0.09]} />
        <meshStandardMaterial color={PALETTE.furnitureDark} roughness={0.6} />
      </mesh>
      {/* mouse */}
      <mesh position={[0.16, SCALE.DESK_HEIGHT + 0.021, 0.1]}>
        <boxGeometry args={[0.03, 0.015, 0.05]} />
        <meshStandardMaterial color={PALETTE.furnitureDark} roughness={0.5} />
      </mesh>
    </group>
  );
}

export function ChairFallback() {
  return (
    <group>
      <mesh position={[0, SCALE.CHAIR_HEIGHT - 0.05, 0]} castShadow>
        <boxGeometry args={[0.34, 0.04, 0.32]} />
        <meshStandardMaterial color={PALETTE.fabric} roughness={0.85} />
      </mesh>
      <mesh position={[0, SCALE.CHAIR_HEIGHT + 0.18, -0.15]} castShadow>
        <boxGeometry args={[0.34, 0.4, 0.04]} />
        <meshStandardMaterial color={PALETTE.fabric} roughness={0.85} />
      </mesh>
      <mesh position={[0, (SCALE.CHAIR_HEIGHT - 0.05) / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.04, SCALE.CHAIR_HEIGHT - 0.05, 8]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.02, 12]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

interface MonitorFallbackProps {
  color?: string;
  /** Base emissive brightness — the resource's status color. */
  intensity?: number;
  /** Animate the screen (DEPLOYING pulse, ERROR flicker) without the parent needing its own useFrame/ref. */
  pulse?: "none" | "slow" | "fast";
}

export function MonitorFallback({ color = PALETTE.screen, intensity = 0.55, pulse = "none" }: MonitorFallbackProps) {
  const screenRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (pulse === "none") return;
    const material = screenRef.current?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) return;
    const speed = pulse === "fast" ? 5 : 1.2;
    material.emissiveIntensity = intensity + Math.sin(clock.elapsedTime * speed) * intensity * 0.6;
  });

  return (
    <group position={[0, SCALE.DESK_HEIGHT, -0.12]}>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.03, 0.16, 0.06]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.02, -0.03]}>
        <boxGeometry args={[0.14, 0.02, 0.09]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, -0.04]}>
        <boxGeometry args={[0.32, 0.2, 0.015]} />
        <meshStandardMaterial color="#0d1015" roughness={0.6} />
      </mesh>
      <mesh ref={screenRef} position={[0, 0.2, -0.031]}>
        <planeGeometry args={[0.28, 0.16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} />
      </mesh>
    </group>
  );
}

export function DualMonitorFallback({ color = PALETTE.screen, intensity = 0.55 }: { color?: string; intensity?: number }) {
  return (
    <group>
      <group position={[-0.12, 0, 0]} rotation={[0, 0.18, 0]}>
        <MonitorFallback color={color} intensity={intensity} />
      </group>
      <group position={[0.12, 0, 0]} rotation={[0, -0.18, 0]}>
        <MonitorFallback color={color} intensity={intensity} />
      </group>
    </group>
  );
}

export function ServerTowerFallback({ color = PALETTE.screen }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.32, 0.7, 0.32]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.5} roughness={0.4} />
      </mesh>
      {[0.15, 0.35, 0.55].map((y) => (
        <mesh key={y} position={[0, y, 0.161]}>
          <planeGeometry args={[0.22, 0.06]} />
          <meshStandardMaterial color={PALETTE.metal} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0.12, 0.6, 0.162]}>
        <circleGeometry args={[0.015, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
}

export function ServerRackFallback({ color = PALETTE.screen, active = true }: { color?: string; active?: boolean }) {
  const unitCount = 8;
  return (
    <group>
      <mesh position={[0, SCALE.RACK_HEIGHT / 2, 0]} castShadow>
        <boxGeometry args={[0.7, SCALE.RACK_HEIGHT, 0.75]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.55} roughness={0.4} />
      </mesh>
      {Array.from({ length: unitCount }).map((_, i) => (
        <mesh key={i} position={[0, 0.15 + i * (SCALE.RACK_HEIGHT / unitCount), 0.376]}>
          <planeGeometry args={[0.58, SCALE.RACK_HEIGHT / unitCount - 0.03]} />
          <meshStandardMaterial color="#0c0f13" roughness={0.7} />
        </mesh>
      ))}
      {Array.from({ length: unitCount }).map((_, i) => (
        <mesh key={`led-${i}`} position={[0.22, 0.15 + i * (SCALE.RACK_HEIGHT / unitCount), 0.378]}>
          <circleGeometry args={[0.012, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.8 : 0.1} />
        </mesh>
      ))}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.76, 0.04, 0.8]} />
        <meshStandardMaterial color={PALETTE.metal} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

export function PlantFallback() {
  return (
    <group>
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.11, 0.28, 10]} />
        <meshStandardMaterial color={PALETTE.furnitureDark} roughness={0.9} />
      </mesh>
      {[
        [0, 0.5, 0],
        [0.12, 0.42, 0.08],
        [-0.1, 0.44, -0.09],
        [0.05, 0.58, -0.08],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <coneGeometry args={[0.16, 0.4, 7]} />
          <meshStandardMaterial color="#2f6b4a" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

export function SofaFallback() {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[1.1, 0.32, 0.5]} />
        <meshStandardMaterial color={PALETTE.fabric} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.5, -0.2]} castShadow>
        <boxGeometry args={[1.1, 0.4, 0.14]} />
        <meshStandardMaterial color={PALETTE.fabric} roughness={0.8} />
      </mesh>
      {[-0.52, 0.52].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]} castShadow>
          <boxGeometry args={[0.14, 0.24, 0.5]} />
          <meshStandardMaterial color={PALETTE.fabric} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function CabinetFallback() {
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.5, 0.9, 0.35]} />
        <meshStandardMaterial color={PALETTE.furniture} roughness={0.7} />
      </mesh>
      {[0.25, 0.6].map((y) => (
        <mesh key={y} position={[0, y, 0.176]}>
          <boxGeometry args={[0.4, 0.02, 0.01]} />
          <meshStandardMaterial color={PALETTE.metal} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export function ReceptionDeskFallback({ accent = PALETTE.screen }: { accent?: string }) {
  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.8, 1.0, 0.5]} />
        <meshStandardMaterial color={PALETTE.furniture} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.5, 0.251]}>
        <planeGeometry args={[1.5, 0.14]} />
        <meshBasicMaterial color={accent} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 1.02, -0.1]}>
        <boxGeometry args={[1.6, 0.04, 0.32]} />
        <meshStandardMaterial color={PALETTE.metal} metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

export function WallScreenFrame({ width, height, accent = PALETTE.screen }: { width: number; height: number; accent?: string }) {
  return (
    <mesh>
      <boxGeometry args={[width + 0.08, height + 0.08, 0.05]} />
      <meshStandardMaterial color="#0b0d12" metalness={0.3} roughness={0.6} emissive={accent} emissiveIntensity={0.04} />
    </mesh>
  );
}
