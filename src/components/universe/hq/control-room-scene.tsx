"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
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
import { WallArt, AccentPanel } from "./assets/office-decor";
import { PALETTE } from "./palette";

export interface CommandCenterStats {
  projectCount: number;
  resourceCount: number;
  onlineCount: number;
  deployingCount: number;
  incidentCount: number;
  employeeCount: number;
}

const CANVAS_W = 1024;
const CANVAS_H = 460;

/** Draws the whole screen fresh — called only when the displayed numbers actually change. */
function paintScreen(ctx: CanvasRenderingContext2D, stats: CommandCenterStats) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "#0a0c11";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.screen;
  ctx.font = "700 30px ui-sans-serif, system-ui";
  ctx.fillText("ID SYSTEM UNIVERSE", CANVAS_W / 2, 58);

  const cols: { label: string; value: number; color: string }[] = [
    { label: "PROJETOS", value: stats.projectCount, color: "#e6e9f0" },
    { label: "RECURSOS", value: stats.resourceCount, color: "#e6e9f0" },
    { label: "ONLINE", value: stats.onlineCount, color: "#34d399" },
    { label: "FUNCIONÁRIOS", value: stats.employeeCount, color: "#e6e9f0" },
    { label: "IMPLANTANDO", value: stats.deployingCount, color: "#38bdf8" },
    { label: "ALERTAS", value: stats.incidentCount, color: stats.incidentCount > 0 ? "#f87171" : "#e6e9f0" },
  ];
  const pad = 56;
  const colWidth = (CANVAS_W - pad * 2) / cols.length;
  cols.forEach((c, i) => {
    const cx = pad + colWidth * i + colWidth / 2;
    ctx.fillStyle = c.color;
    ctx.font = "800 60px ui-sans-serif, system-ui";
    ctx.fillText(String(c.value), cx, 220);
    ctx.fillStyle = "#8890a3";
    ctx.font = "600 15px ui-sans-serif, system-ui";
    ctx.fillText(c.label, cx, 254);
    ctx.fillStyle = c.color;
    ctx.fillRect(cx - 26, 268, 52, 3);
  });

  const ok = stats.incidentCount === 0;
  const dotX = CANVAS_W / 2 - 118;
  ctx.fillStyle = ok ? "#34d399" : "#f87171";
  ctx.beginPath();
  ctx.arc(dotX, 340, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#e6e9f0";
  ctx.font = "700 20px ui-sans-serif, system-ui";
  ctx.fillText(ok ? "OPERAÇÃO NORMAL" : "ATENÇÃO NECESSÁRIA", dotX + 18, 347);
}

/**
 * The building's big screen — a real object in the 3D world (CanvasTexture on the screen's
 * own mesh), not a floating HTML overlay: it stays physically attached to the wall as the
 * camera moves, and only redraws when the numbers it shows actually change.
 */
function BigScreen({ width, stats }: { width: number; stats: CommandCenterStats }) {
  const screenWidth = width * 0.62;
  const screenHeight = 1.55;
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  // Created once, attached to the (always-rendered) material's ref from inside an effect —
  // never read a ref during render, and a real object like this belongs in a ref, not
  // useState/useMemo, since its whole point is to be mutated imperatively afterward.
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textureRef.current = texture;
    if (materialRef.current) {
      materialRef.current.map = texture;
      materialRef.current.needsUpdate = true;
    }
    return () => texture.dispose();
  }, []);

  const statsKey = `${stats.projectCount}|${stats.resourceCount}|${stats.onlineCount}|${stats.deployingCount}|${stats.incidentCount}|${stats.employeeCount}`;
  useEffect(() => {
    const texture = textureRef.current;
    if (!texture) return;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintScreen(ctx, stats);
    texture.needsUpdate = true;
    // Redraw only when the displayed numbers change, never on every polling tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsKey]);

  return (
    <group position={[0, WALL_HEIGHT * 0.62, -3.65]}>
      <WallScreenFrame width={screenWidth} height={screenHeight} />
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[screenWidth - 0.06, screenHeight - 0.06]} />
        <meshBasicMaterial ref={materialRef} toneMapped={false} />
      </mesh>
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
        floorKind="command"
        glowTint="cool"
        nameplateEmphasis
        onSelectRoom={onSelectRoom}
        onFocusRoom={onFocusRoom}
      >
        <BigScreen width={room.width} stats={stats} />

        {/* Slim side panels — the closest a cutaway room gets to "painéis laterais" without a wall blocking the view in. */}
        <group position={[-room.width / 2 + 0.05, 1.3, -1]}>
          <AccentPanel accent={room.accent} />
        </group>
        <group position={[room.width / 2 - 0.05, 1.3, -1]}>
          <AccentPanel accent={room.accent} />
        </group>
        {/* Flanking the big screen, clear of its own footprint (screenWidth ≈ width*0.62). */}
        <group position={[-5.8, 1.4, -3.63]}>
          <WallArt variant="diagram" accent={room.accent} seed={11} width={0.5} height={0.34} />
        </group>
        <group position={[5.8, 1.4, -3.63]}>
          <WallArt variant="graph" accent={room.accent} seed={23} width={0.5} height={0.34} />
        </group>

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
