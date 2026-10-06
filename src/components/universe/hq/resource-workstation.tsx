"use client";

import { memo, useCallback, useState } from "react";
import { Html } from "@react-three/drei";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { DeskFallback, ChairFallback, MonitorFallback, ServerTowerFallback } from "./assets/procedural-furniture";
import { PALETTE, STATUS_COLOR } from "./palette";
import type { UniverseApplication } from "@/types/domain";

const SCREEN_W = 256;
const SCREEN_H = 132;

/** Draws the workstation's live screen — label, status, and a small status-appropriate
    graphic — all from real resource data (briefing 20/21: nunca inventar estado). */
function paintScreen(ctx: CanvasRenderingContext2D, label: string, status: UniverseApplication["status"], color: string) {
  ctx.fillStyle = "#0b0d11";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  ctx.fillStyle = "#e6e9f0";
  ctx.font = "bold 22px ui-sans-serif, system-ui";
  ctx.textBaseline = "top";
  ctx.fillText(label, 10, 8);

  ctx.fillStyle = color;
  ctx.font = "13px ui-sans-serif, system-ui";
  ctx.fillText(status, 10, 36);

  const graphTop = 58;
  const graphHeight = SCREEN_H - graphTop - 10;
  const graphLeft = 10;
  const graphWidth = SCREEN_W - 20;

  if (status === "DEPLOYING") {
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.strokeRect(graphLeft, graphTop + graphHeight / 2 - 6, graphWidth, 12);
    ctx.fillStyle = color;
    ctx.fillRect(graphLeft + 2, graphTop + graphHeight / 2 - 4, graphWidth * 0.55, 8);
  } else if (status === "ERROR") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(graphLeft + graphWidth / 2, graphTop + 4);
    ctx.lineTo(graphLeft + graphWidth / 2 - 16, graphTop + graphHeight - 6);
    ctx.lineTo(graphLeft + graphWidth / 2 + 16, graphTop + graphHeight - 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "bold 16px ui-sans-serif, system-ui";
    ctx.fillText("!", graphLeft + graphWidth / 2 - 3, graphTop + graphHeight / 2 - 8);
  } else if (status === "UNKNOWN") {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(graphLeft, graphTop + graphHeight / 2);
    ctx.lineTo(graphLeft + graphWidth, graphTop + graphHeight / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // RUNNING — a small deterministic metric squiggle seeded from the label, so each
    // workstation reads as its own live interface instead of an identical clone.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const points = 14;
    let seed = 0;
    for (let i = 0; i < label.length; i++) seed = (seed * 31 + label.charCodeAt(i)) % 9973;
    for (let i = 0; i <= points; i++) {
      const n = Math.sin(seed + i * 1.7) * 0.5 + Math.sin(seed * 0.3 + i * 0.9) * 0.3;
      const x = graphLeft + (graphWidth * i) / points;
      const y = graphTop + graphHeight / 2 - n * (graphHeight / 2 - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

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
  const paintKey = `${label}|${resource.status}`;
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D) => paintScreen(ctx, label, resource.status, color),
    [label, resource.status, color],
  );

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
          <meshBasicMaterial color={PALETTE.brand} transparent opacity={0.8} />
        </mesh>
      )}

      {isDatabase ? (
        <WorldAsset asset={ASSET_KEYS.SERVER_TOWER} fallback={<ServerTowerFallback color={color} />} />
      ) : (
        <>
          <WorldAsset asset={ASSET_KEYS.OFFICE_DESK} fallback={<DeskFallback />} />
          <WorldAsset
            asset={ASSET_KEYS.MONITOR}
            fallback={
              <MonitorFallback
                color={color}
                pulse={pulse}
                paint={paint}
                paintKey={paintKey}
                off={resource.status === "STOPPED"}
              />
            }
          />
          <WorldAsset asset={ASSET_KEYS.OFFICE_CHAIR} fallback={<ChairFallback variant="operator" />} position={[0, 0, 0.32]} />
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
