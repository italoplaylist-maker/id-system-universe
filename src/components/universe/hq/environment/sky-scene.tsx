"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { EnvironmentState } from "./environment-state";
import type { WeatherCondition } from "@/app/api/environment/weather/route";

/** Piecewise day/night/twilight sky color, driven purely by sun altitude — cloud cover
    flattens it toward gray. Used directly as the Canvas background + fog color, which is
    far cheaper and safer than a sphere/shader skybox and reads just as well at this scale. */
export function skyColor(altitudeDeg: number, cloudCover: number): THREE.Color {
  let color: THREE.Color;
  if (altitudeDeg > 20) color = new THREE.Color("#5f8fd9");
  else if (altitudeDeg > 0) color = new THREE.Color("#3a5a9c").lerp(new THREE.Color("#5f8fd9"), altitudeDeg / 20);
  else if (altitudeDeg > -10) color = new THREE.Color("#141c33").lerp(new THREE.Color("#a4522f"), 1 - Math.abs(altitudeDeg) / 10);
  else color = new THREE.Color("#05060c");
  const cloud = new THREE.Color("#3d4452");
  return color.lerp(cloud, THREE.MathUtils.clamp(cloudCover / 100, 0, 1) * 0.55);
}

function CelestialDisc({ direction, distance, size, color, opacity }: { direction: [number, number, number]; distance: number; size: number; color: string; opacity: number }) {
  if (opacity <= 0.01) return null;
  const pos: [number, number, number] = [direction[0] * distance, Math.max(direction[1] * distance, 1), direction[2] * distance];
  return (
    <mesh position={pos}>
      <circleGeometry args={[size, 24]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Stars({ radius, opacity }: { radius: number; opacity: number }) {
  const positions = useMemo(() => {
    const count = 420;
    const arr = new Float32Array(count * 3);
    // Deterministic — a fixed starfield, not reshuffled every render.
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 0.9); // keep stars mostly above the horizon
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = radius * Math.cos(phi);
      arr[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    return arr;
  }, [radius]);

  if (opacity <= 0.02) return null;
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={1.4} sizeAttenuation={false} transparent opacity={opacity} depthWrite={false} />
    </points>
  );
}

/** Sun + moon discs and a starfield only — the sky's own color lives on the Canvas
    background/fog (see hq-scene.tsx), never a separate dome sphere. */
export function SkyScene({
  env,
  weatherCondition,
  radius,
  reducedGraphics,
}: {
  env: EnvironmentState;
  weatherCondition: WeatherCondition | null;
  radius: number;
  reducedGraphics: boolean;
}) {
  const farDistance = Math.max(radius * 4, 60);
  const cloudCover = weatherCondition === "NUBLADO" || weatherCondition === "CHUVA" || weatherCondition === "CHUVA_FORTE" ? 85 : weatherCondition === "PARCIALMENTE_NUBLADO" ? 45 : 5;
  const altitudeDeg = (env.sun.altitude * 180) / Math.PI;

  const sunVisible = env.sun.altitude > -0.02;
  const sunOpacity = sunVisible ? THREE.MathUtils.clamp(1 - cloudCover / 130, 0.25, 1) : 0;
  const moonVisible = env.moon.altitude > 0;
  const moonBrightness = 0.45 + (1 - Math.abs(env.moonPhase - 0.5) * 2) * 0.55;

  return (
    <group>
      {!reducedGraphics && <Stars radius={farDistance * 0.98} opacity={THREE.MathUtils.clamp(-altitudeDeg / 12, 0, 1) * (1 - cloudCover / 140)} />}
      <CelestialDisc direction={env.sunDirection} distance={farDistance} size={farDistance * 0.045} color="#fff3d6" opacity={sunOpacity} />
      {moonVisible && <CelestialDisc direction={env.moonDirection} distance={farDistance} size={farDistance * 0.025} color="#e8ecf5" opacity={moonBrightness} />}
    </group>
  );
}
