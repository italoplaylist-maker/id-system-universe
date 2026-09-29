"use client";

import { memo, useState } from "react";
import { Html } from "@react-three/drei";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { ServerRackFallback } from "./assets/procedural-furniture";
import type { UniverseProviderSummary } from "@/types/domain";

const HEALTH_COLOR: Record<UniverseProviderSummary["health"], string> = {
  ONLINE: "#34d399",
  DEGRADED: "#fbbf24",
  OFFLINE: "#f87171",
  UNKNOWN: "#8890a3",
};

const RACK_HEIGHT = 2.0;

interface ProviderRackProps {
  provider: UniverseProviderSummary;
  position: [number, number];
  selected: boolean;
  onSelect: (id: string) => void;
  /** Double-click — camera focuses close on this rack. */
  onFocus?: () => void;
}

/** One physical rack per InfrastructureProvider — the server room never has more or fewer racks than configured providers. */
export const ProviderRack = memo(function ProviderRack({ provider, position, selected, onSelect, onFocus }: ProviderRackProps) {
  const [hovered, setHovered] = useState(false);
  const color = HEALTH_COLOR[provider.health];

  return (
    <group
      position={[position[0], 0, position[1]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(provider.id);
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
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.65, 24]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
        </mesh>
      )}

      <WorldAsset asset={ASSET_KEYS.SERVER_RACK} fallback={<ServerRackFallback color={color} active={provider.health !== "OFFLINE"} />} />

      <Html position={[0, RACK_HEIGHT + 0.18, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: 11, color: "#e6e9f0", fontFamily: "ui-sans-serif, system-ui", whiteSpace: "nowrap" }}>{provider.name}</span>
      </Html>

      {hovered && (
        <Html position={[0, RACK_HEIGHT + 0.42, 0]} center distanceFactor={7} occlude>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl">
            <p className="font-semibold text-foreground">{provider.name}</p>
            <p className="text-muted">
              {provider.health} · {provider.applicationCount} resources
            </p>
          </div>
        </Html>
      )}
    </group>
  );
});
