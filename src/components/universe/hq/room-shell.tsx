"use client";

import { memo, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { WALL_HEIGHT, WALL_THICKNESS, type OpenSide } from "./hq-layout";
import { getOfficeFloorTexture, type FloorKind } from "./assets/office-decor";
import { WindowGlass, Blinds } from "./assets/window";
import { useCameraStore } from "@/store/camera-store";

/** A real window punched into the south (back) wall — offset from wall center, sized, with
    corporate blinds left mostly open. Only the south wall supports this today. */
export interface WindowSpec {
  offsetX: number;
  width: number;
  height: number;
  sillY: number;
  openFraction: number;
}

const GLOW_TINT: Record<"neutral" | "cool" | "warm", string> = { neutral: "#e8ecf5", cool: "#bcd7ff", warm: "#ffe3bc" };
const FLOOR_TINT: Record<FloorKind, string> = { project: "#252d3a", command: "#1c222c", server: "#171d25" };

const OUTWARD_NORMAL: Record<OpenSide, [number, number, number]> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

/**
 * Architectural-cutaway walls. In Overview the whole building is a locked, 100%-solid
 * maquette — you only ever see inside through each room's one designed-open (north) side.
 * In Focus (orbiting close to a Project/Resource/Control Room), a wall that ends up BETWEEN
 * the free-orbiting camera and the room's interior fades toward near-transparent instead of
 * blocking the view — "front" is whichever side currently faces the camera, not a fixed one.
 * `depthWrite={false}` while faded keeps it from still occluding the room behind it (a
 * transparent mesh that keeps writing depth blocks exactly as much as an opaque one would).
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

    // Read imperatively (not a reactive selector) — this runs once per wall per frame,
    // and every room in the building has several of these.
    if (useCameraStore.getState().mode === "overview") {
      material.opacity += (1 - material.opacity) * 0.2;
      material.depthWrite = true;
      return;
    }

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

// Low, pinned to the floor edge — an architectural plaque at the base of the
// opening, not a sign floating up in the doorway.
const NAMEPLATE_Y = 0.3;

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
 * A small architectural plaque pinned to the floor edge at the room's open side — billboarded
 * HTML (not drei's `Text`, which pulls a unicode-font-resolver fallback from a remote CDN, a
 * dependency this self-hosted app shouldn't have and one that hangs the whole Suspense tree
 * when that host is unreachable), so it always stays upright and legible as the camera orbits.
 * Click selects AND focuses the camera on it — same as the room body, just reachable from the
 * sign too. Identifies the room; doesn't dominate the scene — discreet by default, only a
 * little brighter on hover/selected, and gone entirely once the room itself is focused (the
 * Project Panel already names it at that point).
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
  lod = "tower",
  selected = false,
  emphasis = false,
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
  selected?: boolean;
  /** Slightly larger type for the one-of-a-kind rooms (e.g. Central de Comando) — still a
      plaque, never a HUD button. */
  emphasis?: boolean;
  onSelect?: () => void;
  onFocus?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Once a room is the camera's actual focus, the Project Panel already identifies it —
  // the plaque would just be clutter sitting between the camera and the room's interior.
  if (lod === "project") return null;

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
  const roomSpan = isNS ? width : depth;
  // 3D-unit size of the (invisible) click target only — not the rendered card, which
  // auto-sizes to its text in CSS pixels below.
  const plateWidth = Math.min(roomSpan * 0.45, name.length * 0.1 + 0.5);
  const longName = name.length > 16;
  // Pixel budget for the name text itself — generous enough that a normal project name
  // never truncates, tightening only for a genuinely narrow room, so it can't reach into
  // a neighboring room's plaque. Ellipsis (below) is the last-resort fallback past that.
  const nameMaxWidthPx = Math.max(90, Math.round(roomSpan * 30));
  const interactive = Boolean(onSelect || onFocus);
  const emphasized = hovered || selected;

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
          <planeGeometry args={[plateWidth + 0.3, 0.4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {/* No `occlude`: a raycast-based occlusion check here flickered as the room's own
          FadingWall toggled opacity/depthWrite underneath it — the nameplate should read
          through a wall anyway, the same way a real building directory sign does.
          `distanceFactor` gives it natural perspective scaling (smaller from far away,
          legible up close) instead of sitting at a fixed HUD-like screen size. */}
      <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: emphasis ? "4px 10px" : "3px 8px",
            borderRadius: 5,
            background: emphasized ? "rgba(20,25,33,0.92)" : "rgba(12,15,20,0.82)",
            border: `1px solid ${selected ? `${accent}99` : hovered ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.12)"}`,
            borderBottom: `2px solid ${accent}`,
            boxShadow: emphasized ? `0 0 6px 0 ${accent}40` : "none",
            fontFamily: "ui-sans-serif, system-ui",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: emphasis ? 13 : longName ? 10.5 : 11.5,
              color: "#e9edf5",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: nameMaxWidthPx,
              minWidth: 0,
            }}
          >
            {name}
          </span>
          {statusColor && <span style={{ width: 5, height: 5, borderRadius: 99, background: statusColor, flexShrink: 0 }} />}
          {lod !== "tower" && statusLabel && <span style={{ fontSize: 9.5, color: "#9aa4b8", flexShrink: 0 }}>{statusLabel}</span>}
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
  /** Which procedural floor texture to use — carpet, command-room graphite, or server-room raised-floor. */
  floorKind?: FloorKind;
  /** A thin accent line on the back wall in the room's own color — a detail, not a repaint. */
  backWallAccent?: boolean;
  /** Tint of the soft ceiling-glow wash — neutral office light, or a cooler/warmer read for special rooms. */
  glowTint?: "neutral" | "cool" | "warm";
  /** A real window (gap + frame + glass + blinds) punched into the south wall. */
  southWindow?: WindowSpec;
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
  /** Slightly larger plaque type — for the one-of-a-kind rooms (Central de Comando). */
  nameplateEmphasis?: boolean;
  onSelectNameplate?: () => void;
  onFocusNameplate?: () => void;
  /** Click anywhere in the room — select it. */
  onSelectRoom?: () => void;
  /** Click anywhere in the room — camera focuses on it, fired alongside onSelectRoom. */
  onFocusRoom?: () => void;
  children?: React.ReactNode;
}

export const RoomShell = memo(function RoomShell({
  width,
  depth,
  name,
  accent,
  openSides,
  floorColor,
  floorKind = "project",
  backWallAccent = false,
  glowTint = "neutral",
  southWindow,
  dimmed = false,
  selected = false,
  tooltipLines,
  doorDistance,
  statusLabel,
  statusColor,
  resourceCount,
  nameplateLod,
  nameplateEmphasis = false,
  onSelectNameplate,
  onFocusNameplate,
  onSelectRoom,
  onFocusRoom,
  children,
}: RoomShellProps) {
  const walls = wallsFor(width, depth, openSides);
  const [hovered, setHovered] = useState(false);
  const interactive = Boolean(onSelectRoom || onFocusRoom);
  // A dark, unstaffed albedo reads as "the lights are off" under any scene lighting —
  // darkening the material itself, not just its accents, is what actually sells it.
  const wallColor = dimmed ? "#20262f" : "#404f64";
  // Shared, cached per floorKind — never rebuilt per room (see office-decor.tsx).
  const floorTexture = useMemo(() => getOfficeFloorTexture(floorKind), [floorKind]);
  const southWall = walls.find((w) => w.side === "south");
  const resolvedFloorColor = floorColor ?? FLOOR_TINT[floorKind];

  return (
    <group>
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial map={floorTexture} color={dimmed ? "#11151b" : resolvedFloorColor} roughness={0.85} />
      </mesh>

      {/* Full-floor hitbox — the whole room is the click target, not just the
          nameplate (briefing: "sala inteira deve possuir interaction target"). */}
      {interactive && (
        <mesh
          position={[0, 0.06, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRoom?.();
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
            <p className="mt-0.5 text-[10px] text-muted">Click to focus</p>
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

      {walls.map((wall) => {
        if (wall.side === "south" && southWindow) {
          const [wallWidth, , thickness] = wall.args;
          const { offsetX, width: ww, height: wh, sillY } = southWindow;
          const topHeight = WALL_HEIGHT - (sillY + wh);
          const leftWidth = wallWidth / 2 + offsetX - ww / 2;
          const rightWidth = wallWidth / 2 - offsetX - ww / 2;
          return (
            <group key="south-window-wall">
              {topHeight > 0.02 && (
                <FadingWall side="south" position={[wall.position[0], sillY + wh + topHeight / 2, wall.position[2]]} args={[wallWidth, topHeight, thickness]} color={wallColor} />
              )}
              {sillY > 0.02 && <FadingWall side="south" position={[wall.position[0], sillY / 2, wall.position[2]]} args={[wallWidth, sillY, thickness]} color={wallColor} />}
              {leftWidth > 0.02 && (
                <FadingWall
                  side="south"
                  position={[wall.position[0] - wallWidth / 2 + leftWidth / 2, sillY + wh / 2, wall.position[2]]}
                  args={[leftWidth, wh, thickness]}
                  color={wallColor}
                />
              )}
              {rightWidth > 0.02 && (
                <FadingWall
                  side="south"
                  position={[wall.position[0] + wallWidth / 2 - rightWidth / 2, sillY + wh / 2, wall.position[2]]}
                  args={[rightWidth, wh, thickness]}
                  color={wallColor}
                />
              )}
              <group position={[wall.position[0] + offsetX, sillY + wh / 2, wall.position[2]]}>
                <WindowGlass width={ww} height={wh} />
                <Blinds width={ww} height={wh} openFraction={southWindow.openFraction} />
              </group>
            </group>
          );
        }
        return <FadingWall key={wall.side} side={wall.side} position={wall.position} args={wall.args} color={wallColor} />;
      })}

      {/* Discreet baseboard along every solid wall's foot. */}
      {walls.map((wall) => (
        <mesh key={`${wall.side}-base`} position={[wall.position[0], 0.09, wall.position[2]]}>
          <boxGeometry args={[wall.args[0], 0.09, wall.args[2]]} />
          <meshStandardMaterial color={dimmed ? "#171c23" : "#2a323e"} roughness={0.65} />
        </mesh>
      ))}

      {/* One subtle accent line on the back wall, in the room's own color — never the whole wall. */}
      {backWallAccent && southWall && (
        <mesh position={[southWall.position[0], WALL_HEIGHT * 0.42, southWall.position[2] + WALL_THICKNESS / 2 + 0.005]}>
          <boxGeometry args={[southWall.args[0] * 0.86, 0.03, 0.01]} />
          <meshBasicMaterial color={accent} transparent opacity={dimmed ? 0.15 : 0.38} />
        </mesh>
      )}

      {/* A thin emissive cap along each wall's top edge — the "lit up at night" read that sells the isometric diorama look. Barely there when the room's shut down. */}
      {walls.map((wall) => (
        <mesh key={`${wall.side}-cap`} position={[wall.position[0], WALL_HEIGHT + 0.005, wall.position[2]]}>
          <boxGeometry args={[wall.args[0], 0.01, wall.args[2]]} />
          <meshBasicMaterial color={accent} transparent opacity={dimmed ? 0.06 : 0.5} />
        </mesh>
      ))}

      {/* Soft, unlit ceiling wash — the "office lighting" read without any physical ceiling
          or a real Light per room (cheap: no lighting calc, just an additive-blended plane). */}
      <mesh position={[0, WALL_HEIGHT - 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width * 0.9, depth * 0.9]} />
        <meshBasicMaterial
          color={GLOW_TINT[glowTint]}
          transparent
          opacity={dimmed ? 0.015 : 0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

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
        selected={selected}
        emphasis={nameplateEmphasis}
        onSelect={onSelectNameplate}
        onFocus={onFocusNameplate}
      />

      {children}
    </group>
  );
});
