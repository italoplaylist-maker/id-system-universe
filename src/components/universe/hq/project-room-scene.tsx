"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomLayout } from "./hq-layout";
import { computeWorkstationLocalPositions } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { ResourceWorkstation } from "./resource-workstation";
import { DigitalEmployee } from "./digital-employee";
import type { UniverseApplication } from "@/types/domain";

interface ProjectRoomSceneProps {
  room: RoomLayout;
  resources: UniverseApplication[];
  selectedResourceId: string | null;
  onSelectResource: (id: string) => void;
  onSelectProject: (projectId: string) => void;
  dimmed?: boolean;
}

/**
 * One idle employee per occupied project room, wandering a small loop near
 * the workstations. Kept to within-room wandering (not full cross-room
 * visits) — ambient life without the cost of a building-wide crowd sim.
 */
function AmbientEmployee({ room }: { room: RoomLayout }) {
  const ref = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.abs(hashCode(room.id)) % 1000, [room.id]);
  const radius = Math.min(room.width, room.depth) * 0.22;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * 0.25 + seed;
    const x = Math.sin(t) * radius;
    const z = Math.cos(t * 0.7) * radius * 0.6 - 0.5;
    ref.current.position.set(x, 0, z);
    ref.current.rotation.y = Math.atan2(Math.cos(t) * -Math.sin(t) * 0.25, -Math.sin(t * 0.7) * 0.7 * radius * 0.6) || 0;
  });

  return (
    <group ref={ref}>
      <DigitalEmployee accent={room.accent} />
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

export function ProjectRoomScene({ room, resources, selectedResourceId, onSelectResource, onSelectProject, dimmed = false }: ProjectRoomSceneProps) {
  const positions = useMemo(() => computeWorkstationLocalPositions(room, resources.length), [room, resources.length]);

  return (
    <group position={[room.x, 0, room.z]}>
      <RoomShell
        width={room.width}
        depth={room.depth}
        name={room.name}
        accent={room.accent}
        openSides={room.openSides}
        dimmed={dimmed}
        onSelectNameplate={room.projectId ? () => onSelectProject(room.projectId!) : undefined}
      >
        {resources.map((resource, index) => (
          <ResourceWorkstation
            key={resource.id}
            resource={resource}
            position={[positions[index]?.[0] ?? 0, 0.1, positions[index]?.[1] ?? 0]}
            selected={resource.id === selectedResourceId}
            onSelect={onSelectResource}
          />
        ))}
        {resources.length > 0 && <AmbientEmployee room={room} />}
      </RoomShell>
    </group>
  );
}
