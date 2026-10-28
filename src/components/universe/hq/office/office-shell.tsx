"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PALETTE } from "../palette";
import { OFFICE, type OfficeLayout } from "./office-layout";
import { useCameraStore } from "@/store/camera-store";

const WALL_COLOR = "#d6d9e0";
const TRIM = "#5b6372";

function makeFloorTexture(width: number, depth: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const plankW = 64;
  const tones = ["#8a6544", "#946d49", "#805c3d", "#99734e", "#8d6846"];
  for (let i = 0; i < 8; i += 1) {
    // staggered planks (running along x), two joints per plank row
    const y = i * plankW;
    const offset = (i * 173) % 512;
    for (let seg = 0; seg < 2; seg += 1) {
      const x0 = (offset + seg * 256) % 512;
      ctx.fillStyle = tones[(i * 3 + seg * 2) % tones.length];
      ctx.fillRect(x0, y, 256, plankW);
      if (x0 + 256 > 512) ctx.fillRect(x0 - 512, y, 256, plankW);
      // grain
      ctx.strokeStyle = "rgba(0,0,0,0.07)";
      for (let g = 0; g < 5; g += 1) {
        ctx.beginPath();
        ctx.moveTo(x0, y + 8 + g * 11);
        ctx.lineTo(x0 + 256, y + 10 + g * 11);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, y, 512, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / 4, depth / 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Wall that stays 100% solid in Overview and fades out (without writing depth) only when the free camera ends up behind it. */
function FadingWall({ outward, position, args, color }: { outward: [number, number, number]; position: [number, number, number]; args: [number, number, number]; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const worldPos = useRef(new THREE.Vector3());
  const toCamera = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    if (!material || !mesh) return;
    if (useCameraStore.getState().mode === "overview") {
      material.opacity += (1 - material.opacity) * 0.2;
      material.depthWrite = true;
      return;
    }
    mesh.getWorldPosition(worldPos.current);
    toCamera.current.copy(camera.position).sub(worldPos.current);
    const facing = toCamera.current.x * outward[0] + toCamera.current.y * outward[1] + toCamera.current.z * outward[2];
    material.opacity += ((facing > 0 ? 0.1 : 1) - material.opacity) * 0.15;
    material.depthWrite = material.opacity > 0.5;
  });

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial ref={materialRef} color={color} roughness={0.85} metalness={0.02} transparent />
    </mesh>
  );
}

/** Floor-to-ceiling glass with slim steel mullions — you see the whole office through it. */
function GlassWall({ length, height, mullions }: { length: number; height: number; mullions: number }) {
  const step = length / mullions;
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial color="#cfe6ff" transparent opacity={0.1} roughness={0.05} metalness={0.3} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: mullions + 1 }).map((_, i) => (
        <mesh key={i} position={[-length / 2 + i * step, height / 2, 0]} castShadow>
          <boxGeometry args={[0.045, height, 0.045]} />
          <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      {[0.05, height - 0.04].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[length, 0.06, 0.06]} />
          <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[length, 0.04, 0.045]} />
        <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

export function OfficeShell({ layout, nocEnabled = false }: { layout: OfficeLayout; nocEnabled?: boolean }) {
  const { width, depth } = layout;
  const H = OFFICE.WALL_HEIGHT;
  const T = OFFICE.WALL_THICKNESS;
  const backZ = -depth / 2;
  const floorTexture = useMemo(() => makeFloorTexture(width, depth), [width, depth]);
  useEffect(() => () => floorTexture.dispose(), [floorTexture]);

  // With the NOC wall, windows only cover the rest of the west wall (from the end of the NOC panel to the front).
  const winStart = nocEnabled ? layout.noc.z1 + 0.15 : -depth / 2;
  const winEnd = depth / 2;
  const winLen = winEnd - winStart;
  const winCenter = (winStart + winEnd) / 2;
  const windowCount = Math.max(1, Math.round(winLen / 4.2));
  const windowStep = (winLen - 1.2) / windowCount;

  return (
    <group>
      {/* foundation plinth + polished floor + front lip */}
      <mesh position={[0, -0.14, 0]} receiveShadow>
        <boxGeometry args={[width + 0.5, 0.28, depth + 0.5]} />
        <meshStandardMaterial color="#cfd2d9" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={floorTexture} roughness={0.38} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.02, depth / 2 + 0.05]}>
        <boxGeometry args={[width + 0.5, 0.05, 0.1]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={0.7} />
      </mesh>
      {/* entrance steps */}
      {[0, 1].map((i) => (
        <mesh key={i} position={[0, -0.05 - i * 0.14 + 0.1, depth / 2 + 0.55 + i * 0.4]} receiveShadow>
          <boxGeometry args={[3.2, 0.14, 0.7]} />
          <meshStandardMaterial color="#c4c7ce" roughness={0.9} />
        </mesh>
      ))}

      {/* back wall + slat acoustic panel behind the screen */}
      <FadingWall outward={[0, 0, -1]} position={[0, H / 2, backZ]} args={[width + T, H, T]} color={WALL_COLOR} />
      <mesh position={[0, layout.screen.y, backZ + T / 2 + 0.03]} receiveShadow>
        <boxGeometry args={[layout.screen.width + 1.0, layout.screen.height + 0.9, 0.04]} />
        <meshStandardMaterial color="#3a2a20" roughness={0.8} />
      </mesh>
      {Array.from({ length: Math.round((layout.screen.width + 1.0) / 0.12) }).map((_, i) => (
        <mesh key={i} position={[-(layout.screen.width + 1.0) / 2 + 0.06 + i * 0.12, layout.screen.y, backZ + T / 2 + 0.065]}>
          <boxGeometry args={[0.06, layout.screen.height + 0.9, 0.03]} />
          <meshStandardMaterial color={i % 5 === 2 ? "#6d4c34" : "#7a5639"} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, H - 0.22, backZ + T / 2 + 0.03]}>
        <boxGeometry args={[width - 0.4, 0.045, 0.03]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={0.9} />
      </mesh>

      {/* west wall: solid base, tall window band with blinds, solid header */}
      <group position={[-width / 2, 0, 0]}>
        <FadingWall outward={[-1, 0, 0]} position={[0, 0.5, 0]} args={[T, 1.0, depth + T]} color={WALL_COLOR} />
        <FadingWall outward={[-1, 0, 0]} position={[0, H - 0.25, 0]} args={[T, 0.5, depth + T]} color={WALL_COLOR} />
        <mesh position={[0.02, 2.15, winCenter]}>
          <planeGeometry args={[winLen, 2.4]} />
          <meshStandardMaterial color="#bcd7ff" transparent opacity={0.16} roughness={0.08} metalness={0.2} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {Array.from({ length: windowCount + 1 }).map((_, i) => (
          <mesh key={i} position={[0.04, 2.15, winStart + 0.6 + i * windowStep]} castShadow>
            <boxGeometry args={[0.1, 2.4, 0.07]} />
            <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.4} />
          </mesh>
        ))}
        {/* horizontal blinds: slats parallel to the window, lowered a different amount in each bay */}
        {Array.from({ length: windowCount }).map((_, i) => {
          const slats = 24;
          const lowered = 6 + ((i * 7) % 8);
          const bayCenter = winStart + 0.6 + (i + 0.5) * windowStep;
          return (
            <group key={i} position={[0.1, 3.35, bayCenter]}>
              {Array.from({ length: lowered }).map((__, k) => (
                <mesh key={k} position={[0, -0.11 - k * (2.4 / slats), 0]}>
                  <boxGeometry args={[0.02, 2.4 / slats - 0.03, windowStep - 0.16]} />
                  <meshStandardMaterial color="#d3d8e2" roughness={0.55} />
                </mesh>
              ))}
            </group>
          );
        })}
      </group>

      {/* east wall: full glass */}
      <group position={[width / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <GlassWall length={depth} height={H} mullions={Math.max(4, Math.round(depth / 2.4))} />
      </group>

      {/* baseboards */}
      <mesh position={[0, 0.07, backZ + T / 2 + 0.02]}>
        <boxGeometry args={[width - 0.2, 0.14, 0.03]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      <mesh position={[-width / 2 + T / 2 + 0.02, 0.07, 0]}>
        <boxGeometry args={[0.03, 0.14, depth - 0.2]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>

      {/* slim steel top frame — no ceiling (architectural cutaway), nothing hanging between the camera and the desks */}
      <mesh position={[0, H + 0.03, backZ]}>
        <boxGeometry args={[width + 0.3, 0.08, 0.2]} />
        <meshStandardMaterial color={TRIM} metalness={0.75} roughness={0.35} />
      </mesh>
      {[-width / 2, width / 2].map((x) => (
        <mesh key={x} position={[x, H + 0.03, 0]}>
          <boxGeometry args={[0.2, 0.08, depth + 0.3]} />
          <meshStandardMaterial color={TRIM} metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}
