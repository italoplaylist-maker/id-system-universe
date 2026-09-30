"use client";

import { Html } from "@react-three/drei";
import { WALL_HEIGHT, type RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";
import { EmployeeModel } from "./assets/employee-model";
import { WorldAsset } from "./assets/world-asset";
import { ASSET_KEYS } from "./assets/asset-keys";
import { DeskFallback, ChairFallback, MonitorFallback, WallScreenFrame } from "./assets/procedural-furniture";
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
  const screenWidth = width * 0.78;
  const screenHeight = screenWidth * 0.36;
  return (
    <group position={[0, WALL_HEIGHT * 0.58, -1.9]}>
      <WallScreenFrame width={screenWidth} height={screenHeight} />
      <Html occlude distanceFactor={6} position={[0, 0, 0.03]}>
        <div
          style={{
            width: Math.round(width * 78),
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

const DESK_XS = [-1.6, -0.55, 0.55, 1.6];

export function CommandCenterScene({ room, stats }: { room: RoomLayout; stats: CommandCenterStats }) {
  return (
    <group position={[room.x, room.y, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        <BigScreen width={room.width} stats={stats} />

        {DESK_XS.map((x, i) => (
          <group key={x} position={[x, 0, -0.3]} rotation={[0, Math.PI, 0]}>
            <WorldAsset asset={ASSET_KEYS.OFFICE_DESK} fallback={<DeskFallback />} />
            <WorldAsset asset={ASSET_KEYS.MONITOR} fallback={<MonitorFallback color={PALETTE.screen} pulse="none" />} />
            <WorldAsset asset={ASSET_KEYS.OFFICE_CHAIR} fallback={<ChairFallback />} position={[0, 0, 0.32]} />
            {i % 2 === 0 && (
              <group position={[0, 0, 0.32]}>
                <EmployeeModel accent={room.accent} pose="seated" activity="working" seed={i} />
              </group>
            )}
          </group>
        ))}
      </RoomShell>
    </group>
  );
}
