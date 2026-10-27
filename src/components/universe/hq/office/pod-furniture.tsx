"use client";

import { useEffect, useMemo, useRef } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/** Shared dimensions (meters) — every pod part is positioned from these, never from magic numbers. */
export const POD = {
  DESK_TOP_Y: 0.74,
  DESK_THICKNESS: 0.04,
  DESK_DEPTH: 0.82,
  DESK_CENTER_Z: 0.84,
  SEAT_TOP_Y: 0.44,
  KEYBOARD_Z: 0.6,
} as const;

const STEEL = "#1d2026";
const ALUMINUM = "#aeb4bf";

// ---------------------------------------------------------------------------
// Ergonomic office chair — gas lift, five-star base on casters, padded seat, mesh back with
// lumbar support, adjustable arms. Variant picks fabric and whether it has a headrest.
// ---------------------------------------------------------------------------

export type ChairStyle = { fabric: string; headrest: boolean };

export function ErgoChair({ style }: { style: ChairStyle }) {
  return (
    <group>
      {/* five-star base + casters */}
      {Array.from({ length: 5 }).map((_, i) => (
        <group key={i} rotation={[0, (i / 5) * Math.PI * 2, 0]}>
          <mesh position={[0.15, 0.085, 0]} rotation={[0, 0, -0.1]} castShadow>
            <boxGeometry args={[0.3, 0.022, 0.045]} />
            <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0.29, 0.04, 0]} castShadow>
            <sphereGeometry args={[0.032, 10, 8]} />
            <meshStandardMaterial color="#0e0f12" roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.095, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 0.04, 14]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>
      {/* gas lift */}
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.028, 0.034, 0.32, 12]} />
        <meshStandardMaterial color="#8d939e" metalness={0.85} roughness={0.25} />
      </mesh>
      {/* seat mechanism + cushion */}
      <mesh position={[0, 0.405, 0]}>
        <boxGeometry args={[0.2, 0.04, 0.22]} />
        <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
      </mesh>
      <RoundedBox args={[0.5, 0.075, 0.5]} radius={0.032} smoothness={3} position={[0, 0.4, 0.01]} castShadow>
        <meshStandardMaterial color={style.fabric} roughness={0.92} />
      </RoundedBox>

      {/* back: tilted group */}
      <group position={[0, 0.46, -0.25]} rotation={[-0.1, 0, 0]}>
        <mesh position={[0, 0.1, 0.02]}>
          <boxGeometry args={[0.05, 0.22, 0.04]} />
          <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
        </mesh>
        <RoundedBox args={[0.46, 0.5, 0.045]} radius={0.02} smoothness={3} position={[0, 0.38, 0]} castShadow>
          <meshStandardMaterial color="#14161b" roughness={0.6} metalness={0.2} />
        </RoundedBox>
        <RoundedBox args={[0.4, 0.44, 0.03]} radius={0.015} smoothness={3} position={[0, 0.38, 0.026]}>
          <meshStandardMaterial color={style.fabric} roughness={0.95} />
        </RoundedBox>
        {/* lumbar */}
        <RoundedBox args={[0.34, 0.11, 0.05]} radius={0.03} smoothness={3} position={[0, 0.22, 0.05]}>
          <meshStandardMaterial color={style.fabric} roughness={0.9} />
        </RoundedBox>
        {style.headrest && (
          <>
            <mesh position={[0, 0.69, 0.0]}>
              <boxGeometry args={[0.03, 0.1, 0.03]} />
              <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
            </mesh>
            <RoundedBox args={[0.26, 0.11, 0.06]} radius={0.035} smoothness={3} position={[0, 0.76, 0.02]}>
              <meshStandardMaterial color={style.fabric} roughness={0.9} />
            </RoundedBox>
          </>
        )}
      </group>

      {/* arms */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.275, 0.43, 0.02]}>
          <mesh position={[0, 0.1, -0.05]}>
            <boxGeometry args={[0.025, 0.2, 0.04]} />
            <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
          </mesh>
          <RoundedBox args={[0.065, 0.03, 0.26]} radius={0.014} smoothness={3} position={[0, 0.215, 0.03]}>
            <meshStandardMaterial color="#101114" roughness={0.7} />
          </RoundedBox>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Keyboard (keys painted once into a shared texture), mouse and pad
// ---------------------------------------------------------------------------

let keysTexture: THREE.CanvasTexture | null = null;
function getKeysTexture(): THREE.CanvasTexture {
  if (keysTexture) return keysTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 176;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#15171c";
  ctx.fillRect(0, 0, 512, 176);
  const rows = [14, 14, 13, 12, 8];
  rows.forEach((n, r) => {
    const gap = 5;
    const keyW = (512 - gap * (n + 1)) / n;
    const y = 10 + r * 32;
    for (let i = 0; i < n; i += 1) {
      const wide = r === 4 && i === 3;
      const w = wide ? keyW * 4 : keyW;
      if (r === 4 && i > 3 && i < 7) continue;
      const x = gap + i * (keyW + gap);
      ctx.fillStyle = "#2a2e37";
      ctx.beginPath();
      ctx.roundRect(x, y, w, 26, 4);
      ctx.fill();
    }
  });
  keysTexture = new THREE.CanvasTexture(canvas);
  keysTexture.colorSpace = THREE.SRGBColorSpace;
  keysTexture.anisotropy = 4;
  return keysTexture;
}

export function Keyboard() {
  const texture = useMemo(() => getKeysTexture(), []);
  return (
    <group position={[0, POD.DESK_TOP_Y + 0.02, POD.KEYBOARD_Z]}>
      <RoundedBox args={[0.44, 0.014, 0.15]} radius={0.006} smoothness={2} position={[0, 0.0, 0]} rotation={[-0.04, 0, 0]} castShadow>
        <meshStandardMaterial color={ALUMINUM} metalness={0.8} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 0.0085, 0]} rotation={[-Math.PI / 2 - 0.04, 0, 0]}>
        <planeGeometry args={[0.425, 0.138]} />
        <meshStandardMaterial map={texture} roughness={0.6} />
      </mesh>
    </group>
  );
}

export function Mouse({ x = 0.36 }: { x?: number }) {
  return (
    <group position={[x, POD.DESK_TOP_Y + 0.02, POD.KEYBOARD_Z]}>
      <RoundedBox args={[0.22, 0.004, 0.2]} radius={0.002} smoothness={2} position={[0, -0.005, 0]}>
        <meshStandardMaterial color="#20232a" roughness={0.9} />
      </RoundedBox>
      <mesh position={[0, 0.012, 0]} scale={[1, 0.55, 1.5]} castShadow>
        <sphereGeometry args={[0.03, 14, 10]} />
        <meshStandardMaterial color="#d6dae2" metalness={0.3} roughness={0.35} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Monitor with a live CanvasTexture (repainted only when `paintKey` changes — never per frame)
// ---------------------------------------------------------------------------

const SCREEN_W = 384;
const SCREEN_H = 216;

export function PodMonitor({
  width = 0.58,
  paint,
  paintKey,
  off,
  accent,
  onClick,
}: {
  width?: number;
  paint?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  paintKey?: string;
  off?: boolean;
  accent: string;
  onClick?: () => void;
}) {
  const height = (width * 9) / 16;
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  // Created once per monitor and attached from inside an effect — the lint rules forbid reading a ref during render.
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    textureRef.current = texture;
    if (materialRef.current) {
      materialRef.current.map = texture;
      materialRef.current.needsUpdate = true;
    }
    return () => texture.dispose();
  }, []);

  useEffect(() => {
    const texture = textureRef.current;
    if (!texture || !paint) return;
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    paint(ctx, SCREEN_W, SCREEN_H);
    texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repaint only when the displayed content changes
  }, [paintKey]);

  const panelY = POD.DESK_TOP_Y + 0.02 + 0.2 + height / 2;
  return (
    <group
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onPointerOver={onClick ? (e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; } : undefined}
      onPointerOut={onClick ? () => { document.body.style.cursor = "auto"; } : undefined}
    >
      {/* stand */}
      <mesh position={[0, POD.DESK_TOP_Y + 0.025, POD.DESK_CENTER_Z + 0.2]} castShadow>
        <cylinderGeometry args={[0.1, 0.11, 0.012, 24]} />
        <meshStandardMaterial color={ALUMINUM} metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, POD.DESK_TOP_Y + 0.12, POD.DESK_CENTER_Z + 0.22]} castShadow>
        <boxGeometry args={[0.04, 0.2, 0.018]} />
        <meshStandardMaterial color={ALUMINUM} metalness={0.85} roughness={0.3} />
      </mesh>
      {/* panel — faces the employee (-z) */}
      <group position={[0, panelY, POD.DESK_CENTER_Z + 0.24]}>
        <RoundedBox args={[width + 0.02, height + 0.02, 0.022]} radius={0.008} smoothness={3} castShadow>
          <meshStandardMaterial color="#101216" roughness={0.45} metalness={0.45} />
        </RoundedBox>
        {/* back shell, the side the camera sees */}
        <RoundedBox args={[width * 0.7, height * 0.7, 0.02]} radius={0.01} smoothness={3} position={[0, 0, 0.018]}>
          <meshStandardMaterial color={ALUMINUM} metalness={0.9} roughness={0.28} />
        </RoundedBox>
        <mesh position={[0, 0, 0.0295]}>
          <circleGeometry args={[0.012, 16]} />
          <meshStandardMaterial color={off ? "#4a4f5a" : accent} emissive={off ? "#000000" : accent} emissiveIntensity={off ? 0 : 0.9} />
        </mesh>
        {/* screen */}
        <mesh position={[0, 0, -0.0116]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[width, height]} />
          {off ? <meshStandardMaterial color="#05070a" roughness={0.25} metalness={0.2} /> : <meshBasicMaterial ref={materialRef} toneMapped={false} />}
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------

export function DeskLamp({ on, color = "#ffd9a0" }: { on: boolean; color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.008, 0]}>
        <cylinderGeometry args={[0.07, 0.075, 0.016, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.02, 0.17, 0]} rotation={[0, 0, -0.18]}>
        <cylinderGeometry args={[0.008, 0.008, 0.33, 8]} />
        <meshStandardMaterial color={ALUMINUM} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.07, 0.33, 0]} rotation={[0, 0, Math.PI / 2 - 0.5]}>
        <cylinderGeometry args={[0.008, 0.008, 0.2, 8]} />
        <meshStandardMaterial color={ALUMINUM} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.15, 0.31, 0]} rotation={[0, 0, Math.PI / 2 + 0.4]}>
        <coneGeometry args={[0.05, 0.08, 16, 1, true]} />
        <meshStandardMaterial color="#d8dce4" metalness={0.5} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.155, 0.285, 0]}>
        <sphereGeometry args={[0.022, 12, 10]} />
        <meshStandardMaterial color={on ? color : "#4a4f5a"} emissive={on ? color : "#000000"} emissiveIntensity={on ? 1.4 : 0} />
      </mesh>
    </group>
  );
}

export function Mug({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.045, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.036, 0.09, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh position={[0.05, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.022, 0.006, 8, 14, Math.PI]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  );
}

export function Notebook({ color }: { color: string }) {
  return (
    <group>
      <RoundedBox args={[0.2, 0.016, 0.28]} radius={0.004} smoothness={2} position={[0, 0.008, 0]}>
        <meshStandardMaterial color={color} roughness={0.7} />
      </RoundedBox>
      <mesh position={[0.012, 0.0175, 0]}>
        <boxGeometry args={[0.18, 0.002, 0.26]} />
        <meshStandardMaterial color="#f2efe6" roughness={0.9} />
      </mesh>
    </group>
  );
}

export function PotPlant({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.045, 0.12, 14]} />
        <meshStandardMaterial color="#e9e6df" roughness={0.8} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos(i * 1.3) * 0.03, 0.17 + (i % 2) * 0.03, Math.sin(i * 1.3) * 0.03]} rotation={[Math.sin(i) * 0.5, 0, Math.cos(i * 2) * 0.5]} scale={[1, 1.6, 0.5]} castShadow>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#3f8f5a" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}
