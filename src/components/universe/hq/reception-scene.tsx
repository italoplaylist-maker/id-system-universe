"use client";

import type { RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { EmployeeModel } from "./assets/employee-model";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { ReceptionDeskFallback, SofaFallback, PlantFallback } from "./assets/procedural-furniture";

/** The building's front door — reception desk, a greeter, a place to sit, nothing operational happens here. */
export function ReceptionScene({ room }: { room: RoomLayout }) {
  return (
    <group position={[room.x, room.y, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        <WorldAsset asset={ASSET_KEYS.RECEPTION_DESK} fallback={<ReceptionDeskFallback accent={room.accent} />} position={[0, 0, -0.9]} />
        <group position={[0, 0, -1.25]} rotation={[0, Math.PI, 0]}>
          <EmployeeModel accent={room.accent} pose="standing" activity="idle" />
        </group>
        <WorldAsset asset={ASSET_KEYS.SOFA} fallback={<SofaFallback />} position={[-room.width / 2 + 1, 0, room.depth / 2 - 0.7]} rotation={Math.PI / 2} />
        <WorldAsset asset={ASSET_KEYS.PLANT} fallback={<PlantFallback />} position={[room.width / 2 - 0.5, 0, room.depth / 2 - 0.5]} />
      </RoomShell>
    </group>
  );
}
