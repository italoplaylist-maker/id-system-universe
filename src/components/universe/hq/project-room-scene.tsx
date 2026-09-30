"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomLayout } from "./hq-layout";
import { computeWorkstationLocalPositions, WALL_THICKNESS } from "./hq-layout";
import { RoomShell, type NameplateLod, type WindowSpec } from "./room-shell";
import { ResourceWorkstation } from "./resource-workstation";
import { EmployeeModel } from "./assets/employee-model";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { PlantFallback } from "./assets/procedural-furniture";
import { WallArt, ART_VARIANTS, WallClock, Whiteboard, Shelf, StorageBoxDecor, BookStack, SideTable, seededRandom, pick } from "./assets/office-decor";
import { Html } from "@react-three/drei";
import type { UniverseApplication } from "@/types/domain";

interface ProjectRoomSceneProps {
  room: RoomLayout;
  resources: UniverseApplication[];
  selectedResourceId: string | null;
  onSelectResource: (id: string) => void;
  /** Click a workstation — camera focuses on that resource. World position (not room-local). */
  onFocusResource?: (resourceId: string, worldPosition: [number, number, number], name: string) => void;
  onSelectNameplate?: () => void;
  dimmed?: boolean;
  /** Room-level selection/focus, distinct from selecting a resource inside it. */
  selected?: boolean;
  tooltipLines?: string[];
  statusLabel?: string;
  statusColor?: string;
  nameplateLod?: NameplateLod;
  onSelectRoom?: () => void;
  onFocusRoom?: () => void;
}

/**
 * One or two idle employees per occupied project room, wandering a small
 * loop near the workstations. Kept to within-room wandering (not full
 * cross-room visits) — ambient life without the cost of a building-wide
 * crowd sim.
 */
function AmbientEmployee({ room, seedOffset = 0 }: { room: RoomLayout; seedOffset?: number }) {
  const ref = useRef<THREE.Group>(null);
  const seed = useMemo(() => (Math.abs(hashCode(room.id)) % 1000) + seedOffset * 137, [room.id, seedOffset]);
  const radius = Math.min(room.width, room.depth) * 0.2;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * 0.22 + seed;
    const x = Math.sin(t) * radius + (seedOffset ? radius * 0.9 : -radius * 0.4);
    const z = Math.cos(t * 0.7) * radius * 0.6 - 0.3;
    ref.current.position.set(x, 0, z);
    ref.current.rotation.y = Math.atan2(Math.cos(t) * -Math.sin(t) * 0.25, -Math.sin(t * 0.7) * 0.7 * radius * 0.6) || 0;
  });

  return (
    <group ref={ref}>
      <EmployeeModel accent={room.accent} pose="walking" activity="idle" seed={seed} />
    </group>
  );
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** A real window only for LARGE rooms, on about half of them — independent seed from
    RoomDecor's own so the two don't fight over the same rand() sequence. Placed on the
    right side of the back wall; RoomDecor keeps that side clear when one is present. */
function computeWindowSpec(room: RoomLayout): WindowSpec | null {
  if (room.size !== "LARGE") return null;
  const rand = seededRandom(Math.abs(hashCode(`${room.id}:window`)) || 1);
  if (rand() < 0.5) return null;
  return { offsetX: room.width * 0.3, width: Math.min(room.width * 0.22, 1.3), height: 1.0, sillY: 0.95, openFraction: 0.7 };
}

/**
 * Wall art, a corner piece and an optional clock — composition picked once
 * per room from its own id, so it's stable across re-renders/refreshes and
 * every room doesn't end up looking like the same office (briefing: no 12
 * identical offices). Density follows room.size: small rooms stay sparse.
 */
function RoomDecor({ room, dimmed, hasWindow }: { room: RoomLayout; dimmed: boolean; hasWindow: boolean }) {
  const seed = Math.abs(hashCode(room.id)) || 1;
  const rand = seededRandom(seed);
  const artCount = room.size === "SMALL" ? 1 : room.size === "MEDIUM" ? 2 : 3;
  const backZ = -room.depth / 2 + WALL_THICKNESS / 2 + 0.03;
  // A window (when present) owns the right side of the back wall — keep art on the left.
  const artSpan = room.width * (hasWindow ? 0.42 : 0.55);
  const artStart = hasWindow ? -room.width * 0.32 : -artSpan / 2;
  const artXs = Array.from({ length: artCount }, (_, i) => (artCount === 1 ? artStart + artSpan / 2 : artStart + (artSpan * i) / (artCount - 1)));
  const cornerVariant = room.size !== "SMALL" ? pick(rand, ["shelf", "storage", "books"] as const) : null;
  const showClock = room.size !== "SMALL" && !hasWindow && rand() > 0.5;
  const showWhiteboard = room.size === "LARGE" && rand() > 0.5;

  return (
    <group>
      {artXs.map((x, i) => (
        <group key={i} position={[x, 1.5, backZ]}>
          <WallArt variant={pick(rand, ART_VARIANTS)} accent={room.accent} seed={seed + i} dim={dimmed} />
        </group>
      ))}
      {showClock && (
        <group position={[room.width / 2 - 0.55, 2.05, backZ]}>
          <WallClock accent={room.accent} />
        </group>
      )}
      {cornerVariant && (
        <group position={[-(room.width / 2 - 0.35), 0, -(room.depth / 2 - 0.35)]}>
          {cornerVariant === "shelf" && <Shelf />}
          {cornerVariant === "storage" && <StorageBoxDecor />}
          {cornerVariant === "books" && (
            <SideTable />
          )}
          {cornerVariant === "books" && (
            <group position={[0, 0.3, 0]}>
              <BookStack />
            </group>
          )}
        </group>
      )}
      {showWhiteboard && (
        <group position={[-(room.width / 2 - 0.04), 1.3, -room.depth / 4]} rotation={[0, Math.PI / 2, 0]}>
          <Whiteboard accent={room.accent} />
        </group>
      )}
    </group>
  );
}

export function ProjectRoomScene({
  room,
  resources,
  selectedResourceId,
  onSelectResource,
  onFocusResource,
  onSelectNameplate,
  dimmed = false,
  selected = false,
  tooltipLines,
  statusLabel,
  statusColor,
  nameplateLod,
  onSelectRoom,
  onFocusRoom,
}: ProjectRoomSceneProps) {
  const positions = useMemo(() => computeWorkstationLocalPositions(room, resources.length), [room, resources.length]);
  // Nobody's staffing a room that's shut down — every resource in it stopped.
  const employeeCount = dimmed || resources.length === 0 ? 0 : resources.length > 3 ? 2 : 1;
  const plantCorner: [number, number, number] = [room.width / 2 - 0.5, 0, -room.depth / 2 + 0.5];
  const plantScale = [0.65, 0.85, 1, 1.2][Math.abs(hashCode(room.id)) % 4];
  const windowSpec = useMemo(() => computeWindowSpec(room), [room]);

  return (
    <group position={[room.x, room.y, room.z]}>
      <RoomShell
        width={room.width}
        depth={room.depth}
        name={room.name}
        accent={room.accent}
        openSides={room.openSides}
        floorKind="project"
        backWallAccent
        southWindow={windowSpec ?? undefined}
        dimmed={dimmed}
        selected={selected}
        tooltipLines={tooltipLines}
        statusLabel={statusLabel}
        statusColor={statusColor}
        resourceCount={resources.length}
        nameplateLod={nameplateLod}
        onSelectNameplate={onSelectNameplate}
        onFocusNameplate={onFocusRoom}
        onSelectRoom={onSelectRoom}
        onFocusRoom={onFocusRoom}
      >
        {resources.map((resource, index) => {
          const local = positions[index] ?? [0, 0];
          return (
            <ResourceWorkstation
              key={resource.id}
              resource={resource}
              position={[local[0], 0.1, local[1]]}
              selected={resource.id === selectedResourceId}
              onSelect={onSelectResource}
              onFocus={onFocusResource ? () => onFocusResource(resource.id, [room.x + local[0], room.y + 0.7, room.z + local[1]], resource.name) : undefined}
            />
          );
        })}
        {Array.from({ length: employeeCount }).map((_, i) => (
          <AmbientEmployee key={i} room={room} seedOffset={i} />
        ))}
        <RoomDecor room={room} dimmed={dimmed} hasWindow={Boolean(windowSpec)} />
        <group position={plantCorner} scale={plantScale}>
          <WorldAsset asset={ASSET_KEYS.PLANT} fallback={<PlantFallback />} />
        </group>
        {resources.length === 0 && (
          <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
            <div style={{ textAlign: "center", fontFamily: "ui-sans-serif, system-ui" }}>
              <p style={{ fontSize: 11, color: "#8890a3", letterSpacing: 1 }}>NO RESOURCES</p>
            </div>
          </Html>
        )}
      </RoomShell>
    </group>
  );
}
