"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { PALETTE } from "../palette";

/** Deterministic seed from a stable id (room/project id) — same room always
    gets the same decor composition, no stored state needed. */
export function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

/** Tiny seeded PRNG (park-miller) — cheap, deterministic, no dependency. */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Picks one element deterministically from a seeded rand()'s next draw. */
export function pick<T>(rand: () => number, options: readonly T[]): T {
  return options[Math.floor(rand() * options.length) % options.length];
}

// ---------------------------------------------------------------------------
// Floor textures — one canvas per room kind, generated once and reused by
// every room of that kind (never per-instance): the expensive part (canvas
// draw + GPU upload) happens at most 3 times total for the whole building.
// ---------------------------------------------------------------------------

export type FloorKind = "project" | "command" | "server";

const floorTextureCache = new Map<FloorKind, THREE.CanvasTexture>();

function paintFloorCanvas(kind: FloorKind): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  if (kind === "project") {
    // A near-white detail mask: the mesh's own `color` (floorColor) does the actual dark
    // tinting via multiply, this only paints the subtle seam/speckle *variation* on top of
    // it — painting it dark here would multiply two dark values together and crush the
    // floor to near-black instead of the intended subtle carpet tile look.
    ctx.fillStyle = "#e9ebef";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const p = i * 32;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(128, p);
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.025).toFixed(3)})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
    }
  } else if (kind === "command") {
    // Same near-white mask approach — wide panel seams, faint screen-colored centerline.
    ctx.fillStyle = "#eef1f5";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    for (let i = 0; i <= 2; i++) {
      const p = i * 64;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(128, p);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(76,201,240,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(64, 128);
    ctx.stroke();
  } else {
    // Server room raised-floor tile: tighter grid, tiny vent dots, same bright mask.
    ctx.fillStyle = "#e6ebf2";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(20,40,70,0.09)";
    for (let i = 0; i <= 4; i++) {
      const p = i * 32;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(128, p);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = "rgba(20,40,70,0.12)";
      ctx.beginPath();
      ctx.arc(16 + Math.random() * 96, 16 + Math.random() * 96, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

/** Fixed tile density per kind — baked in at creation, never mutated per-room
    (the texture object is shared, so a per-room `.repeat` would fight itself). */
const FLOOR_REPEAT: Record<FloorKind, number> = { project: 5, command: 3, server: 6 };

export function getOfficeFloorTexture(kind: FloorKind): THREE.CanvasTexture {
  const cached = floorTextureCache.get(kind);
  if (cached) return cached;
  const texture = new THREE.CanvasTexture(paintFloorCanvas(kind));
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(FLOOR_REPEAT[kind], FLOOR_REPEAT[kind]);
  texture.colorSpace = THREE.SRGBColorSpace;
  floorTextureCache.set(kind, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// WallArt — small procedural "picture frame" panels. A handful of cheap
// canvas-drawn variants instead of downloaded images; cached by
// variant+accent+seed so the same composition never redraws a canvas twice.
// ---------------------------------------------------------------------------

export type ArtVariant = "abstract" | "graph" | "geometric" | "landscape" | "diagram" | "poster";
export const ART_VARIANTS: readonly ArtVariant[] = ["abstract", "graph", "geometric", "landscape", "diagram", "poster"];

const wallArtCache = new Map<string, THREE.CanvasTexture>();

function paintArtCanvas(variant: ArtVariant, accent: string, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);
  ctx.fillStyle = "#11151c";
  ctx.fillRect(0, 0, 192, 128);

  if (variant === "abstract") {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? `${accent}55` : "#ffffff22";
      ctx.beginPath();
      ctx.arc(20 + rand() * 152, 20 + rand() * 88, 18 + rand() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === "graph") {
    const bars = 6;
    for (let i = 0; i < bars; i++) {
      const h = 14 + rand() * 78;
      ctx.fillStyle = i === bars - 1 ? accent : "#8890a3";
      ctx.fillRect(16 + i * 26, 108 - h, 16, h);
    }
  } else if (variant === "geometric") {
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = i % 2 === 0 ? accent : "#ffffff33";
      ctx.lineWidth = 2;
      ctx.strokeRect(14 + i * 14, 14 + i * 10, 160 - i * 28, 96 - i * 20);
    }
  } else if (variant === "landscape") {
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#1c2430");
    grad.addColorStop(1, "#11151c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 192, 128);
    ctx.fillStyle = `${accent}44`;
    ctx.beginPath();
    ctx.moveTo(0, 90);
    ctx.lineTo(60, 50);
    ctx.lineTo(110, 78);
    ctx.lineTo(150, 40);
    ctx.lineTo(192, 70);
    ctx.lineTo(192, 128);
    ctx.lineTo(0, 128);
    ctx.closePath();
    ctx.fill();
  } else if (variant === "diagram") {
    const boxes: [number, number][] = [
      [20, 46],
      [86, 46],
      [152, 46],
    ];
    ctx.strokeStyle = "#8890a3";
    ctx.lineWidth = 2;
    boxes.forEach(([x, y], i) => {
      ctx.strokeRect(x, y, 20, 20);
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(boxes[i - 1][0] + 20, y + 10);
        ctx.lineTo(x, y + 10);
        ctx.stroke();
      }
    });
    ctx.fillStyle = accent;
    ctx.fillRect(boxes[1][0], boxes[1][1], 20, 20);
  } else {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 192, 46);
    ctx.fillStyle = "#e6e9f0";
    ctx.font = "700 20px ui-sans-serif, system-ui";
    ctx.fillText("SYSTEM", 16, 32);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = "#8890a3";
      ctx.fillRect(16, 66 + i * 16, 130 - i * 24, 6);
    }
  }

  return canvas;
}

export function getWallArtTexture(variant: ArtVariant, accent: string, seed: number): THREE.CanvasTexture {
  const key = `${variant}:${accent}:${seed}`;
  const cached = wallArtCache.get(key);
  if (cached) return cached;
  const texture = new THREE.CanvasTexture(paintArtCanvas(variant, accent, seed));
  texture.colorSpace = THREE.SRGBColorSpace;
  wallArtCache.set(key, texture);
  return texture;
}

export function WallArt({
  variant,
  accent,
  width = 0.46,
  height = 0.32,
  seed = 1,
  dim = false,
}: {
  variant: ArtVariant;
  accent: string;
  width?: number;
  height?: number;
  seed?: number;
  dim?: boolean;
}) {
  const texture = useMemo(() => getWallArtTexture(variant, accent, seed), [variant, accent, seed]);
  return (
    <group>
      <mesh>
        <boxGeometry args={[width + 0.04, height + 0.04, 0.02]} />
        <meshStandardMaterial color="#0c0f14" roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0, 0.011]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent opacity={dim ? 0.4 : 1} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Small procedural office decor — cheap boxes, reused across every room.
// ---------------------------------------------------------------------------

export function Shelf() {
  return (
    <group>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.5, 1.1, 0.26]} />
        <meshStandardMaterial color={PALETTE.furnitureDark} roughness={0.75} />
      </mesh>
      {[0.25, 0.55, 0.85].map((y) => (
        <mesh key={y} position={[0, y, 0.01]}>
          <boxGeometry args={[0.46, 0.02, 0.22]} />
          <meshStandardMaterial color={PALETTE.metal} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

export function StorageBoxDecor() {
  return (
    <group>
      <mesh position={[0, 0.14, 0]} castShadow>
        <boxGeometry args={[0.32, 0.28, 0.28]} />
        <meshStandardMaterial color={PALETTE.uniformAlt} roughness={0.8} />
      </mesh>
      <mesh position={[-0.2, 0.09, 0.02]} castShadow>
        <boxGeometry args={[0.22, 0.18, 0.22]} />
        <meshStandardMaterial color={PALETTE.uniform} roughness={0.8} />
      </mesh>
    </group>
  );
}

export function BookStack() {
  const colors = ["#5b6b82", "#8890a3", "#4a5a70"];
  return (
    <group>
      {colors.map((c, i) => (
        <mesh key={c} position={[0, 0.02 + i * 0.045, 0]} castShadow>
          <boxGeometry args={[0.24 - i * 0.02, 0.04, 0.17]} />
          <meshStandardMaterial color={c} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

export function SideTable() {
  return (
    <group>
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.34, 0.03, 0.34]} />
        <meshStandardMaterial color={PALETTE.furniture} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.28, 8]} />
        <meshStandardMaterial color={PALETTE.metalDark} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

export function Whiteboard({ accent }: { accent: string }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.66, 0.44, 0.02]} />
        <meshStandardMaterial color="#eef1f6" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.011]}>
        <planeGeometry args={[0.6, 0.02]} />
        <meshBasicMaterial color="#33404f" />
      </mesh>
      <mesh position={[0.16, -0.08, 0.011]}>
        <planeGeometry args={[0.28, 0.014]} />
        <meshBasicMaterial color="#33404f" transparent opacity={0.6} />
      </mesh>
      <mesh position={[-0.18, 0.1, 0.011]}>
        <circleGeometry args={[0.05, 16]} />
        <meshBasicMaterial color={accent} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

export function WallClock({ accent }: { accent: string }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.015, 20]} />
        <meshStandardMaterial color="#e6e9f0" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.009]}>
        <circleGeometry args={[0.062, 20]} />
        <meshStandardMaterial color="#171c24" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.01, 0.011]}>
        <boxGeometry args={[0.006, 0.04, 0.002]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
  );
}

/** A slim vertical accent panel — the closest thing to "side panels" a cutaway
    room can have without a wall that would block the view inside. */
export function AccentPanel({ accent, height = 1.4 }: { accent: string; height?: number }) {
  return (
    <mesh>
      <boxGeometry args={[0.03, height, 0.4]} />
      <meshStandardMaterial color="#151a21" emissive={accent} emissiveIntensity={0.12} roughness={0.5} metalness={0.2} />
    </mesh>
  );
}
