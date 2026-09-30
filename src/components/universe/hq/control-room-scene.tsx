"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { WALL_HEIGHT, type RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { EmployeeModel } from "./assets/employee-model";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import {
  DeskFallback,
  ChairFallback,
  MonitorFallback,
  WallScreenFrame,
  ReceptionDeskFallback,
  SofaFallback,
  PlantFallback,
} from "./assets/procedural-furniture";
import { PALETTE } from "./palette";

export interface CommandCenterStats {
  projectCount: number;
  resourceCount: number;
  onlineCount: number;
  deployingCount: number;
  incidentCount: number;
}

function StatBlock({ label, value, tone, divider }: { label: string; value: number; tone: "default" | "good" | "warn" | "bad"; divider: boolean }) {
  const color = tone === "good" ? "#34d399" : tone === "warn" ? "#38bdf8" : tone === "bad" ? "#f87171" : "#e6e9f0";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 6px 14px",
        borderLeft: divider ? "1px solid rgba(255,255,255,0.08)" : "none",
        position: "relative",
      }}
    >
      <span style={{ fontSize: 42, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1.6, color: "#9aa4b8", textTransform: "uppercase" }}>{label}</span>
      <div style={{ position: "absolute", bottom: 0, left: "26%", right: "26%", height: 3, borderRadius: 2, background: color }} />
    </div>
  );
}

/**
 * The building's big screen — real aggregate numbers from the same data
 * every other view uses, never a separately invented figure.
 */
function BigScreen({ width, stats }: { width: number; stats: CommandCenterStats }) {
  const screenWidth = width * 0.62;
  const screenHeight = 1.55;
  return (
    <group position={[0, WALL_HEIGHT * 0.62, -3.65]}>
      <WallScreenFrame width={screenWidth} height={screenHeight} />
      <Html occlude distanceFactor={6} position={[0, 0, 0.03]}>
        <div
          style={{
            width: Math.round(screenWidth * 100),
            padding: "20px 28px 16px",
            borderRadius: 10,
            background: "linear-gradient(180deg, #10131a, #090b10)",
            border: "1px solid rgba(255,255,255,0.06)",
            fontFamily: "ui-sans-serif, system-ui",
            position: "relative",
          }}
        >
          <div style={{ position: "absolute", top: -32, left: 0, right: 0, textAlign: "center", fontSize: 12, fontWeight: 600, letterSpacing: 4, color: PALETTE.screen }}>
            ID SYSTEM UNIVERSE
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
            <StatBlock label="Projetos" value={stats.projectCount} tone="default" divider={false} />
            <StatBlock label="Recursos" value={stats.resourceCount} tone="default" divider />
            <StatBlock label="Online" value={stats.onlineCount} tone="good" divider />
            <StatBlock label="Implantando" value={stats.deployingCount} tone="warn" divider />
            <StatBlock label="Incidentes" value={stats.incidentCount} tone={stats.incidentCount > 0 ? "bad" : "default"} divider />
          </div>
        </div>
      </Html>
    </group>
  );
}

const DESK_POSITIONS: [number, number][] = [
  [-4.5, -2.2],
  [0, -2.2],
  [4.5, -2.2],
  [-4.5, -0.6],
  [0, -0.6],
  [4.5, -0.6],
];

/** A standby employee at a control-room desk — this is the pool every task agent conceptually walks out from. */
function StandbyEmployee({ accent, seed }: { accent: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = Math.sin(clock.elapsedTime * 1.2 + seed) * 0.01;
  });
  return (
    <group ref={ref}>
      <EmployeeModel accent={accent} pose="seated" activity="working" seed={seed} />
    </group>
  );
}

function OpsDesk({ x, z, manned, accent, seed }: { x: number; z: number; manned: boolean; accent: string; seed: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, Math.PI, 0]}>
      <WorldAsset asset={ASSET_KEYS.OFFICE_DESK} fallback={<DeskFallback />} />
      <WorldAsset asset={ASSET_KEYS.MONITOR} fallback={<MonitorFallback color={PALETTE.screen} pulse="none" />} />
      <WorldAsset asset={ASSET_KEYS.OFFICE_CHAIR} fallback={<ChairFallback />} position={[0, 0, 0.32]} />
      {manned && (
        <group position={[0, 0, 0.32]}>
          <StandbyEmployee accent={accent} seed={seed} />
        </group>
      )}
    </group>
  );
}

/**
 * The single, complete control room at the top of the building: a front desk near the
 * door, the big information screen on the back wall, and a bank of operations desks
 * facing it in between — the front desk, command center and operations floor merged
 * into one staffed room instead of three separate ones.
 */
export function ControlRoomScene({
  room,
  stats,
  onSelectRoom,
  onFocusRoom,
}: {
  room: RoomLayout;
  stats: CommandCenterStats;
  onSelectRoom?: () => void;
  onFocusRoom?: () => void;
}) {
  const mannedCount = Math.max(2, DESK_POSITIONS.length - stats.deployingCount);

  return (
    <group position={[room.x, room.y, room.z]}>
      <RoomShell
        width={room.width}
        depth={room.depth}
        name={room.name}
        accent={room.accent}
        openSides={room.openSides}
        nameplateEmphasis
        onSelectRoom={onSelectRoom}
        onFocusRoom={onFocusRoom}
      >
        <BigScreen width={room.width} stats={stats} />

        {DESK_POSITIONS.map(([x, z], i) => (
          <OpsDesk key={i} x={x} z={z} manned={i < mannedCount} accent={room.accent} seed={i} />
        ))}

        {/* Front desk, near the door — the building's reception. */}
        <group position={[4.5, 0, 2.9]}>
          <WorldAsset asset={ASSET_KEYS.RECEPTION_DESK} fallback={<ReceptionDeskFallback accent={room.accent} />} />
        </group>
        <group position={[4.5, 0, 1.55]} rotation={[0, Math.PI, 0]}>
          <EmployeeModel accent={room.accent} pose="standing" activity="idle" />
        </group>

        {/* Waiting area, opposite the front desk. */}
        <WorldAsset asset={ASSET_KEYS.SOFA} fallback={<SofaFallback />} position={[-4.7, 0, 3]} rotation={Math.PI} />
        <WorldAsset asset={ASSET_KEYS.PLANT} fallback={<PlantFallback />} position={[-6, 0, 2]} />
        <WorldAsset asset={ASSET_KEYS.PLANT} fallback={<PlantFallback />} position={[6, 0, -3.2]} />
      </RoomShell>
    </group>
  );
}
