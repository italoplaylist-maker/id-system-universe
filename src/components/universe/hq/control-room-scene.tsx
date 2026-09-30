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

function StatBlock({ label, value, tone }: { label: string; value: number; tone: "default" | "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "#34d399" : tone === "warn" ? "#38bdf8" : tone === "bad" ? "#f87171" : "#e6e9f0";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, letterSpacing: 1.3, color: "#8890a3", textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

/**
 * The building's big screen — real aggregate numbers from the same data
 * every other view uses, never a separately invented figure.
 */
function BigScreen({ width, stats }: { width: number; stats: CommandCenterStats }) {
  const screenWidth = width * 0.5;
  const screenHeight = screenWidth * 0.36;
  return (
    <group position={[0, WALL_HEIGHT * 0.58, -3.65]}>
      <WallScreenFrame width={screenWidth} height={screenHeight} />
      <Html occlude distanceFactor={6} position={[0, 0, 0.03]}>
        <div
          style={{
            width: Math.round(screenWidth * 100),
            padding: "14px 20px",
            borderRadius: 8,
            background: "#0b0d12",
            display: "flex",
            justifyContent: "space-around",
            fontFamily: "ui-sans-serif, system-ui",
          }}
        >
          <div style={{ position: "absolute", top: -34, left: 0, right: 0, textAlign: "center", fontSize: 10, letterSpacing: 3, color: PALETTE.screen }}>
            ID SYSTEM UNIVERSE
          </div>
          <StatBlock label="Projects" value={stats.projectCount} tone="default" />
          <StatBlock label="Resources" value={stats.resourceCount} tone="default" />
          <StatBlock label="Online" value={stats.onlineCount} tone="good" />
          <StatBlock label="Deploying" value={stats.deployingCount} tone="warn" />
          <StatBlock label="Incidents" value={stats.incidentCount} tone={stats.incidentCount > 0 ? "bad" : "default"} />
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
