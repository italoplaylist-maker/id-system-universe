"use client";

import { memo, useState } from "react";
import { Html } from "@react-three/drei";
import type { OpenSide } from "./hq-layout";

// Deliberately below employee shoulder height (~1.5) rather than the "real"
// door height — a full-height wall on the side facing the camera blocks the
// one thing this diorama exists to show (briefing 14: "paredes cutaway").
const WALL_HEIGHT = 1.3;
const WALL_THICKNESS = 0.12;
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

/**
 * A physical sign above the room's main opening — mounted like a real
 * doorway header. The plate mesh is a real 3D object oriented to the wall;
 * its label renders as billboarded HTML (not drei's `Text`, which pulls a
 * unicode-font-resolver fallback from a remote CDN — a dependency this
 * self-hosted app shouldn't have at all, and one that hangs the whole
 * Suspense tree when that host is unreachable).
 */
function Nameplate({
  name,
  accent,
  width,
  depth,
  side,
  onSelect,
}: {
  name: string;
  accent: string;
  width: number;
  depth: number;
  side: OpenSide;
  onSelect?: () => void;
}) {
  const isNS = side === "north" || side === "south";
  const edgeOffset = (isNS ? depth : width) / 2 + 0.08;
  const position: [number, number, number] =
    side === "north"
      ? [0, NAMEPLATE_Y, edgeOffset]
      : side === "south"
        ? [0, NAMEPLATE_Y, -edgeOffset]
        : side === "east"
          ? [edgeOffset, NAMEPLATE_Y, 0]
          : [-edgeOffset, NAMEPLATE_Y, 0];
  const plateWidth = Math.min((isNS ? width : depth) * 0.75, name.length * 0.15 + 0.4);

  return (
    <group
      position={position}
      onClick={(e) => {
        if (!onSelect) return;
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh rotation={[0, NAMEPLATE_ROTATION[side], 0]}>
        <boxGeometry args={[plateWidth, 0.3, 0.03]} />
        <meshStandardMaterial color="#0d0f14" metalness={0.4} roughness={0.5} />
      </mesh>
      <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: accent,
            fontFamily: "ui-sans-serif, system-ui",
            whiteSpace: "nowrap",
          }}
        >
          {name.toUpperCase()}
        </span>
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
  onSelectNameplate?: () => void;
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
  onSelectNameplate,
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
        <mesh key={wall.side} position={wall.position} castShadow receiveShadow>
          <boxGeometry args={wall.args} />
          <meshStandardMaterial color="#31384a" roughness={0.75} metalness={0.05} />
        </mesh>
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

      <Nameplate name={name} accent={accent} width={width} depth={depth} side={openSides[0] ?? "south"} onSelect={onSelectNameplate} />

      {children}
    </group>
  );
});
