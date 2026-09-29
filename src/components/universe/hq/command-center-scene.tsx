"use client";

import { Html } from "@react-three/drei";
import type { RoomLayout } from "./hq-layout";
import { RoomShell } from "./room-shell";

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
      <span style={{ fontSize: 34, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 10, letterSpacing: 1.5, color: "#8890a3", textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

/**
 * The building's big screen — real aggregate numbers from the same data
 * every other view uses, never a separately invented figure.
 */
function BigScreen({ width, stats }: { width: number; stats: CommandCenterStats }) {
  return (
    <Html occlude distanceFactor={6} position={[0, 1.35, -0.05]}>
      <div
        style={{
          width: Math.round(width * 90),
          padding: "18px 24px",
          borderRadius: 10,
          background: "#0b0d12",
          border: "1px solid #1f2430",
          boxShadow: "0 0 40px rgba(56,189,248,0.15)",
          display: "flex",
          justifyContent: "space-around",
          fontFamily: "ui-sans-serif, system-ui",
        }}
      >
        <StatBlock label="Projects" value={stats.projectCount} tone="default" />
        <StatBlock label="Resources" value={stats.resourceCount} tone="default" />
        <StatBlock label="Online" value={stats.onlineCount} tone="good" />
        <StatBlock label="Deploying" value={stats.deployingCount} tone="warn" />
        <StatBlock label="Incidents" value={stats.incidentCount} tone={stats.incidentCount > 0 ? "bad" : "default"} />
      </div>
    </Html>
  );
}

export function CommandCenterScene({ room, stats }: { room: RoomLayout; stats: CommandCenterStats }) {
  return (
    <group position={[room.x, 0, room.z]}>
      <RoomShell width={room.width} depth={room.depth} name={room.name} accent={room.accent} openSides={room.openSides}>
        <BigScreen width={room.width} stats={stats} />

        {/* Console desk facing the screen */}
        <mesh position={[0, 0.35, 0.6]} castShadow>
          <boxGeometry args={[room.width * 0.55, 0.05, 0.6]} />
          <meshStandardMaterial color="#181c24" roughness={0.5} />
        </mesh>
        {[-1, 0, 1].map((offset) => (
          <mesh key={offset} position={[offset * (room.width * 0.16), 0.55, 0.4]}>
            <boxGeometry args={[0.18, 0.11, 0.01]} />
            <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.4} />
          </mesh>
        ))}
      </RoomShell>
    </group>
  );
}
