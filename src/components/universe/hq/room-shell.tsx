"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { WALL_HEIGHT, WALL_THICKNESS, type OpenSide } from "./hq-layout";

const OUTWARD_NORMAL: Record<OpenSide, [number, number, number]> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

/**
 * Architectural-cutaway walls: instead of one statically-open side, every wall fades toward
 * near-transparent whenever the orbiting camera is on the outside looking in through it —
 * "front" is whichever side currently faces the camera, not a fixed one, so no wall is ever
 * allowed to sit between camera and interior. `depthWrite={false}` while fading keeps a
 * faded-out wall from still occluding the room behind it (a transparent mesh that keeps
 * writing depth blocks exactly as much as an opaque one would).
 */
function FadingWall({ side, position, args, color }: { side: OpenSide; position: [number, number, number]; args: [number, number, number]; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const worldPos = useRef(new THREE.Vector3());
  const toCamera = useRef(new THREE.Vector3());
  const outward = OUTWARD_NORMAL[side];

  useFrame(({ camera }) => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    if (!material || !mesh) return;
    mesh.getWorldPosition(worldPos.current);
    toCamera.current.copy(camera.position).sub(worldPos.current);
    const facingCamera = toCamera.current.x * outward[0] + toCamera.current.y * outward[1] + toCamera.current.z * outward[2];
    const target = facingCamera > 0 ? 0.08 : 1;
    material.opacity += (target - material.opacity) * 0.15;
    material.depthWrite = material.opacity > 0.5;
  });

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial ref={materialRef} color={color} roughness={0.75} metalness={0.05} transparent />
    </mesh>
  );
}

// Deliberately below employee shoulder height (~1.5) rather than the "real"
// door height — a full-height wall on the side facing the camera blocks the
// one thing this diorama exists to show (briefing 14: "paredes cutaway").
const NAMEPLATE_Y = WALL_HEIGHT + 0.32;

interface WallSpec {
  side: OpenSide;
  position: [number, number, number];
  args: [number, number, number];
}

function wallsFor(width: number, depth: number, openSides: OpenSide[]): WallSpec[] {
  const specs: WallSpec[] = [
    { side: "north", position: [0, WALL_HEIGHT / 2, depth / 2], args: [width, WALL_HEIGHT, WALL_THICKNESS] },
    { side: "south", position: [0, WALL_HEIGHT / 2, -depth / 2], args: [width, WALL_HEIGHT, WALL_THICKNESS] },
    { side: "east", position: [width / 2, WALL_HEIGHT / 2, 0], args: [WALL_THICKNESS, WALL_HEIGHT, depth] },
    { side: "west", position: [-width / 2, WALL_HEIGHT / 2, 0], args: [WALL_THICKNESS, WALL_HEIGHT, depth] },
  ];
  return specs.filter((s) => !openSides.includes(s.side));
}

/** A thin, low glass rail marking an "open" side — reads as a glass front without blocking the view inside. */
function GlassRail({ side, width, depth }: { side: OpenSide; width: number; depth: number }) {
  const railHeight = 0.5;
  const isNS = side === "north" || side === "south";
  const position: [number, number, number] = isNS
    ? [0, railHeight / 2, side === "north" ? depth / 2 : -depth / 2]
    : [side === "east" ? width / 2 : -width / 2, railHeight / 2, 0];
  const args: [number, number, number] = isNS ? [width, railHeight, 0.04] : [0.04, railHeight, depth];

  return (
    <mesh position={position}>
      <boxGeometry args={args} />
      <meshPhysicalMaterial color="#8fd8ff" transparent opacity={0.16} roughness={0.1} metalness={0} />
    </mesh>
  );
}

const NAMEPLATE_ROTATION: Record<OpenSide, number> = {
  north: 0,
  south: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
};

/** How much detail a nameplate shows, driven by what the camera is currently focused on —
    never more than the current context needs, so distant/overview shots stay uncluttered. */
export type NameplateLod = "tower" | "floor" | "project";

/**
 * A dark-premium translucent card floating just in front of the room's open side — billboarded
 * HTML (not drei's `Text`, which pulls a unicode-font-resolver fallback from a remote CDN, a
 * dependency this self-hosted app shouldn't have and one that hangs the whole Suspense tree
 * when that host is unreachable), so it always stays upright and legible as the camera orbits.
 * Click selects, double-click focuses — same as the room body, just reachable from the sign too.
 */
function Nameplate({
  name,
  accent,
  width,
  depth,
  side,
  doorDistance = 0.08,
  statusLabel,
  statusColor,
  resourceCount,
  lod = "tower",
  onSelect,
  onFocus,
}: {
  name: string;
  accent: string;
  width: number;
  depth: number;
  side: OpenSide;
  /** How far past the room's own wall the sign sits — for a room set back from the
      corridor by a vestibule, this should reach the real corridor door, not stop
      at the room's own (closer) wall, so there's exactly one door per room instead
      of two that don't line up as the camera moves. */
  doorDistance?: number;
  statusLabel?: string;
  statusColor?: string;
  resourceCount?: number;
  lod?: NameplateLod;
  onSelect?: () => void;
  onFocus?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isNS = side === "north" || side === "south";
  const edgeOffset = (isNS ? depth : width) / 2 + doorDistance;
  const position: [number, number, number] =
    side === "north"
      ? [0, NAMEPLATE_Y, edgeOffset]
      : side === "south"
        ? [0, NAMEPLATE_Y, -edgeOffset]
        : side === "east"
          ? [edgeOffset, NAMEPLATE_Y, 0]
          : [-edgeOffset, NAMEPLATE_Y, 0];
  const plateWidth = Math.min((isNS ? width : depth) * 0.75, name.length * 0.15 + 0.6);
  const interactive = Boolean(onSelect || onFocus);

  return (
    <group position={position}>
      {/* Comfortable click/hover target — the card itself (Html) is pointer-events:none so it
          never eats clicks meant for the room behind it; this plane, oriented the same way the
          old physical plate was, is the real hit target. */}
      {interactive && (
        <mesh
          rotation={[0, NAMEPLATE_ROTATION[side], 0]}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onFocus?.();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = "auto";
          }}
        >
          <planeGeometry args={[plateWidth + 0.4, 0.55]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {/* No `occlude`: a raycast-based occlusion check here flickered as the room's own
          FadingWall toggled opacity/depthWrite underneath it — the nameplate should read
          through a wall anyway, the same way a real building directory sign does. */}
      <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 6,
            background: hovered ? "rgba(22,27,36,0.92)" : "rgba(12,15,20,0.8)",
            border: `1px solid ${hovered ? accent : "rgba(255,255,255,0.14)"}`,
            fontFamily: "ui-sans-serif, system-ui",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: "#f2f5fa" }}>{name.toUpperCase()}</span>
          {statusColor && <span style={{ width: 6, height: 6, borderRadius: 99, background: statusColor, flexShrink: 0 }} />}
          {lod !== "tower" && statusLabel && <span style={{ fontSize: 11, color: "#aab3c5" }}>{statusLabel}</span>}
          {lod === "project" && resourceCount != null && (
            <span style={{ fontSize: 11, color: "#7b8496" }}>· {resourceCount} RES</span>
          )}
        </div>
      </Html>
    </group>
  );
}

export interface RoomShellProps {
  width: number;
  depth: number;
  name: string;
  accent: string;
  openSides: OpenSide[];
  floorColor?: string;
  dimmed?: boolean;
  selected?: boolean;
  /** e.g. ["5 Resources", "Healthy"] — shown in the hover tooltip under the room name. */
  tooltipLines?: string[];
  /** Passed straight to Nameplate — how far past the room's own wall its door (and sign) sits. */
  doorDistance?: number;
  /** Nameplate-only extras — status dot, its label, and how much of it to show. */
  statusLabel?: string;
  statusColor?: string;
  resourceCount?: number;
  nameplateLod?: NameplateLod;
  onSelectNameplate?: () => void;
  onFocusNameplate?: () => void;
  /** Single click anywhere in the room — select without moving the camera. */
  onSelectRoom?: () => void;
  /** Double click anywhere in the room — camera focuses on it (briefing: "double click → focus"). */
  onFocusRoom?: () => void;
  children?: React.ReactNode;
}

export const RoomShell = memo(function RoomShell({
  width,
  depth,
  name,
  accent,
  openSides,
  floorColor = "#151923",
  dimmed = false,
  selected = false,
  tooltipLines,
  doorDistance,
  statusLabel,
  statusColor,
  resourceCount,
  nameplateLod,
  onSelectNameplate,
  onFocusNameplate,
  onSelectRoom,
  onFocusRoom,
  children,
}: RoomShellProps) {
  const walls = wallsFor(width, depth, openSides);
  const [hovered, setHovered] = useState(false);
  const interactive = Boolean(onSelectRoom || onFocusRoom);

  return (
    <group>
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.9} />
      </mesh>

      {/* Full-floor hitbox — the whole room is the click target, not just the
          nameplate (briefing: "sala inteira deve possuir interaction target"). */}
      {interactive && (
        <mesh
          position={[0, 0.06, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRoom?.();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onFocusRoom?.();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = "auto";
          }}
        >
          <boxGeometry args={[width - 0.05, 0.01, depth - 0.05]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {interactive && hovered && (
        <Html position={[0, 0.9, 0]} center distanceFactor={8} occlude style={{ pointerEvents: "none" }}>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl">
            <p className="font-semibold text-foreground">{name}</p>
            {tooltipLines?.map((line) => (
              <p key={line} className="text-muted">
                {line}
              </p>
            ))}
            <p className="mt-0.5 text-[10px] text-muted">Double-click to focus</p>
          </div>
        </Html>
      )}

      {/* Accent floor trim so a room reads as "this project's color" without painting the whole floor. */}
      <mesh position={[0, 0.051, -depth / 2 + 0.04]}>
        <boxGeometry args={[width, 0.02, 0.08]} />
        <meshBasicMaterial color={accent} transparent opacity={dimmed ? 0.25 : hovered || selected ? 1 : 0.7} />
      </mesh>

      {/* Hover/selected outline — a thin frame just inside the walls, on every open side too, so the whole footprint reads as "this is clickable/selected." */}
      {(hovered || selected) && (
        <>
          <mesh position={[0, 0.03, depth / 2 - 0.03]}>
            <boxGeometry args={[width - 0.1, 0.04, 0.03]} />
            <meshBasicMaterial color={accent} transparent opacity={0.55} />
          </mesh>
          <mesh position={[0, 0.03, -depth / 2 + 0.03]}>
            <boxGeometry args={[width - 0.1, 0.04, 0.03]} />
            <meshBasicMaterial color={accent} transparent opacity={0.55} />
          </mesh>
          <mesh position={[width / 2 - 0.03, 0.03, 0]}>
            <boxGeometry args={[0.03, 0.04, depth - 0.1]} />
            <meshBasicMaterial color={accent} transparent opacity={0.55} />
          </mesh>
          <mesh position={[-width / 2 + 0.03, 0.03, 0]}>
            <boxGeometry args={[0.03, 0.04, depth - 0.1]} />
            <meshBasicMaterial color={accent} transparent opacity={0.55} />
          </mesh>
        </>
      )}

      {walls.map((wall) => (
        <FadingWall key={wall.side} side={wall.side} position={wall.position} args={wall.args} color="#31384a" />
      ))}

      {/* A thin emissive cap along each wall's top edge — the "lit up at night" read that sells the isometric diorama look. */}
      {walls.map((wall) => (
        <mesh key={`${wall.side}-cap`} position={[wall.position[0], WALL_HEIGHT + 0.005, wall.position[2]]}>
          <boxGeometry args={[wall.args[0], 0.01, wall.args[2]]} />
          <meshBasicMaterial color={accent} transparent opacity={dimmed ? 0.2 : 0.5} />
        </mesh>
      ))}

      {openSides.map((side) => (
        <GlassRail key={side} side={side} width={width} depth={depth} />
      ))}

      <Nameplate
        name={name}
        accent={accent}
        width={width}
        depth={depth}
        side={openSides[0] ?? "south"}
        doorDistance={doorDistance}
        statusLabel={statusLabel}
        statusColor={statusColor}
        resourceCount={resourceCount}
        lod={nameplateLod}
        onSelect={onSelectNameplate}
        onFocus={onFocusNameplate}
      />

      {children}
    </group>
  );
});
