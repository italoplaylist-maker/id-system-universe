"use client";

import type { HqLayout, RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { ProviderRack } from "./provider-rack";
import { EmployeeModel } from "./assets/employee-model";
import type { UniverseProviderSummary } from "@/types/domain";

interface ServerRoomSceneProps {
  room: RoomLayout;
  racks: HqLayout["serverRacks"];
  providers: UniverseProviderSummary[];
  selectedProviderId: string | null;
  onSelectProvider: (id: string) => void;
}

export function ServerRoomScene({ room, racks, providers, selectedProviderId, onSelectProvider }: ServerRoomSceneProps) {
  const providerById = new Map(providers.map((p) => [p.id, p]));

  return (
    <group position={[room.x, 0, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        {racks.map((rack) => {
          const provider = providerById.get(rack.providerId);
          if (!provider) return null;
          return (
            <ProviderRack
              key={rack.providerId}
              provider={provider}
              position={[rack.x, rack.z - room.z]}
              selected={rack.providerId === selectedProviderId}
              onSelect={onSelectProvider}
            />
          );
        })}
        {racks.length > 0 && (
          <group position={[0, 0, room.depth / 2 - 1]}>
            <EmployeeModel accent={room.accent} pose="standing" activity="idle" />
          </group>
        )}
      </RoomShell>
    </group>
  );
}
