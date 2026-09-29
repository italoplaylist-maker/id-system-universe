"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomLayout } from "./hq-layout";
import { computeWorkstationLocalPositions, ROOM_GAP } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { ResourceWorkstation } from "./resource-workstation";
import { EmployeeModel } from "./assets/employee-model";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { PlantFallback } from "./assets/procedural-furniture";
import { Html } from "@react-three/drei";
import type { UniverseApplication } from "@/types/domain";

interface ProjectRoomSceneProps {
  room: RoomLayout;
  resources: UniverseApplication[];
  selectedResourceId: string | null;
  onSelectResource: (id: string) => void;
  /** Double-click a workstation — camera focuses on that resource. World position (not room-local). */
  onFocusResource?: (resourceId: string, worldPosition: [number, number, number], name: string) => void;
  onSelectNameplate?: () => void;
  dimmed?: boolean;
  /** Room-level selection/focus, distinct from selecting a resource inside it. */
  selected?: boolean;
  tooltipLines?: string[];
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
  onSelectRoom,
  onFocusRoom,
}: ProjectRoomSceneProps) {
  const positions = useMemo(() => computeWorkstationLocalPositions(room, resources.length), [room, resources.length]);
  const employeeCount = resources.length === 0 ? 0 : resources.length > 3 ? 2 : 1;
  const plantCorner: [number, number, number] = [room.width / 2 - 0.5, 0, -room.depth / 2 + 0.5];

  return (
    <group position={[room.x, room.y, room.z]}>
      <RoomShell
        width={room.width}
        depth={room.depth}
        name={room.name}
        accent={room.accent}
        openSides={room.openSides}
        dimmed={dimmed}
        selected={selected}
        tooltipLines={tooltipLines}
        // Left/right rooms sit a full vestibule back from the corridor's real
        // door; center rooms (default 0.08) open directly onto it already.
        doorDistance={room.side === "center" ? undefined : ROOM_GAP - 0.05}
        onSelectNameplate={onSelectNameplate}
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
        <WorldAsset asset={ASSET_KEYS.PLANT} fallback={<PlantFallback />} position={plantCorner} />
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
