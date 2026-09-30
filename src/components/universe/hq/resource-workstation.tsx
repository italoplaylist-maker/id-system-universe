"use client";

import { memo, useState } from "react";
import { Html } from "@react-three/drei";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { DeskFallback, ChairFallback, MonitorFallback, ServerTowerFallback } from "./assets/procedural-furniture";
import { STATUS_COLOR } from "./palette";
import type { UniverseApplication } from "@/types/domain";

/** Short, human label — never the raw resource name/UUID (briefing 22). */
function shortLabel(resource: UniverseApplication): string {
  const name = resource.name.toLowerCase();
  if (resource.resourceType === "DATABASE" || /postgres|mysql|redis|mongo|database|-db$/.test(name)) return "DB";
  if (/api/.test(name)) return "API";
  if (/worker|queue|job/.test(name)) return "WORKER";
  if (/bot|chat/.test(name)) return "BOT";
  if (/web|site|frontend|app$/.test(name)) return "WEB";
  return resource.name.length > 10 ? resource.name.slice(0, 9) + "…" : resource.name.toUpperCase();
}

interface ResourceWorkstationProps {
  resource: UniverseApplication;
  position: [number, number, number];
  selected: boolean;
  onSelect: (id: string) => void;
  /** Click — camera focuses close on this workstation, fired alongside onSelect. */
  onFocus?: () => void;
}

export const ResourceWorkstation = memo(function ResourceWorkstation({ resource, position, selected, onSelect, onFocus }: ResourceWorkstationProps) {
  const [hovered, setHovered] = useState(false);
  const color = STATUS_COLOR[resource.status];
  const pulse = resource.status === "DEPLOYING" ? "slow" : resource.status === "ERROR" ? "fast" : "none";
  const isDatabase = resource.resourceType === "DATABASE";
  const label = shortLabel(resource);

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(resource.id);
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
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.5, 24]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
        </mesh>
      )}

      {isDatabase ? (
        <WorldAsset asset={ASSET_KEYS.SERVER_TOWER} fallback={<ServerTowerFallback color={color} />} />
      ) : (
        <>
          <WorldAsset asset={ASSET_KEYS.OFFICE_DESK} fallback={<DeskFallback />} />
          <WorldAsset asset={ASSET_KEYS.MONITOR} fallback={<MonitorFallback color={color} pulse={pulse} />} />
          <WorldAsset asset={ASSET_KEYS.OFFICE_CHAIR} fallback={<ChairFallback />} position={[0, 0, 0.32]} />
        </>
      )}

      <Html position={[0, isDatabase ? 0.82 : 0.74, 0]} center distanceFactor={8} occlude style={{ pointerEvents: "none" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#e6e9f0", fontFamily: "ui-sans-serif, system-ui" }}>{label}</span>
          <span style={{ fontSize: 9, color, display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
            {resource.status}
          </span>
        </div>
      </Html>

      {hovered && (
        <Html position={[0, isDatabase ? 1.05 : 0.98, 0]} center distanceFactor={7} occlude>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl">
            <p className="font-semibold text-foreground">{resource.name}</p>
            <p className="text-muted">
              {resource.status} · {resource.providerName}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
});
