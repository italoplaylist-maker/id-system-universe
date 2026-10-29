"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { EmployeeModel } from "../assets/employee-model";
import { ErgoChair, Keyboard, Mouse, DeskLamp, Mug, PodMonitor, POD, type ChairStyle } from "./pod-furniture";
import { hashSeed } from "../assets/office-decor";
import { PALETTE } from "../palette";
import type { DeskSlot } from "./office-layout";
import type { AgentSessionView } from "@/server/claude/agent-service";

const WORK_BLUE = "#1f7bff";
const ERROR_RED = "#ff5a5f";
const OAK = new THREE.Color("#c8a47a");
const BLUE = new THREE.Color(WORK_BLUE);
const RED = new THREE.Color(ERROR_RED);
const CHAIR: ChairStyle = { fabric: "#2b303b", headrest: true };

const STATE_LABEL = { WORKING: "TRABALHANDO", IDLE: "AGUARDANDO", ERROR: "ERRO NA FERRAMENTA" } as const;
const STATE_COLOR = { WORKING: "#38bdf8", IDLE: "#8890a3", ERROR: "#f87171" } as const;

export function agentTitle(s: Pick<AgentSessionView, "repo" | "id">): string {
  if (s.repo) return s.repo.split("/").filter(Boolean).pop() ?? s.repo;
  return `Agente ${s.id.slice(-4)}`;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

function paintAgent(ctx: CanvasRenderingContext2D, w: number, h: number, s: AgentSessionView, accent: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0d1422");
  g.addColorStop(1, "#080b12");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 6, h);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#6f7a90";
  ctx.font = "600 13px ui-sans-serif, system-ui";
  ctx.fillText("AGENTE CLAUDE", 24, 28);
  ctx.fillStyle = "#f2f5fb";
  ctx.font = "700 27px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, agentTitle(s), w - 48), 24, 62);
  ctx.fillStyle = "#8f9bb3";
  ctx.font = "500 14px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, s.branch ?? "—", w - 48), 24, 84);

  ctx.fillStyle = STATE_COLOR[s.state];
  ctx.beginPath();
  ctx.arc(34, 114, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "800 22px ui-sans-serif, system-ui";
  ctx.fillText(STATE_LABEL[s.state], 54, 122);

  ctx.fillStyle = "#e6ebf5";
  ctx.font = "600 17px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, s.activity ?? "Sem atividade ainda", w - 48), 24, 156);
  ctx.fillStyle = "#7d889d";
  ctx.font = "500 14px ui-sans-serif, system-ui";
  ctx.fillText(`${s.toolCount} ferramentas · ${s.failedCount} falhas · ${hhmm(s.lastEventAt)}`, 24, 190);
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

interface AgentDeskProps {
  slot: DeskSlot;
  session: AgentSessionView;
  selected: boolean;
  dimmedByFocus: boolean;
  reduced: boolean;
  onFocus: () => void;
}

/** Uma sessão de agente Claude = uma mesa: azul e digitando quando trabalha, vermelha se a última ferramenta falhou, calma quando aguarda. */
export const AgentDesk = memo(function AgentDesk({ slot, session, selected, dimmedByFocus, reduced, onFocus }: AgentDeskProps) {
  const [hovered, setHovered] = useState(false);
  const seed = useMemo(() => hashSeed(session.id), [session.id]);
  const state = session.state;
  const deskWidth = 1.5;

  const topMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const haloMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const blend = useRef({ work: state === "WORKING" ? 1 : 0, error: state === "ERROR" ? 1 : 0, ring: 0 });
  const tmp = useRef(new THREE.Color());

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const b = blend.current;
    b.work = damp(b.work, state === "WORKING" ? 1 : 0, 6, dt);
    b.error = damp(b.error, state === "ERROR" ? 1 : 0, 6, dt);
    b.ring = damp(b.ring, selected ? 1 : hovered ? 0.55 : 0, 10, dt);
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4);
    const glow = Math.max(b.work, b.error);
    if (topMaterial.current) {
      tmp.current.copy(OAK).lerp(b.error > b.work ? RED : BLUE, glow * 0.85);
      topMaterial.current.color.copy(tmp.current);
      topMaterial.current.emissive.copy(b.error > b.work ? RED : BLUE);
      topMaterial.current.emissiveIntensity = glow * (0.55 + 0.3 * pulse);
    }
    if (haloMaterial.current) haloMaterial.current.opacity = glow * (0.28 + 0.14 * pulse);
    if (ringMaterial.current) ringMaterial.current.opacity = b.ring * 0.85;
  });

  const paint = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => paintAgent(ctx, w, h, session, slot.accent), [session, slot.accent]);
  const paintKey = `${session.state}|${session.activity}|${session.toolCount}|${session.failedCount}|${session.lastEventAt}|${session.repo}|${session.branch}`;
  const pivotZ = POD.DESK_CENTER_Z + 0.24;

  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, Math.PI, 0]}>
      <RoundedBox args={[2.7, 0.012, 2.45]} radius={0.04} smoothness={2} position={[0, 0.006, 0.45]} receiveShadow>
        <meshStandardMaterial color="#2a303c" roughness={1} />
      </RoundedBox>
      <mesh position={[0, 0.016, 0.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.6, 40]} />
        <meshBasicMaterial ref={haloMaterial} color={WORK_BLUE} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.42, 1.5, 48]} />
        <meshBasicMaterial ref={ringMaterial} color={PALETTE.brand} transparent opacity={0} depthWrite={false} />
      </mesh>

      <RoundedBox args={[deskWidth, POD.DESK_THICKNESS, POD.DESK_DEPTH]} radius={0.016} smoothness={3} position={[0, POD.DESK_TOP_Y - POD.DESK_THICKNESS / 2, POD.DESK_CENTER_Z]} castShadow receiveShadow>
        <meshStandardMaterial ref={topMaterial} color="#c8a47a" roughness={0.55} metalness={0.02} />
      </RoundedBox>
      {[-1, 1].map((sd) => (
        <group key={sd} position={[sd * (deskWidth / 2 - 0.07), 0, POD.DESK_CENTER_Z]}>
          <mesh position={[0, (POD.DESK_TOP_Y - POD.DESK_THICKNESS) / 2, 0]} castShadow>
            <boxGeometry args={[0.045, POD.DESK_TOP_Y - POD.DESK_THICKNESS, 0.045]} />
            <meshStandardMaterial color="#1b1e25" metalness={0.7} roughness={0.4} />
          </mesh>
        </group>
      ))}

      <group position={[0, 0, pivotZ]}>
        <group position={[0, 0, -pivotZ]}>
          <PodMonitor width={0.78} paint={paint} paintKey={paintKey} accent={slot.accent} onClick={onFocus} />
        </group>
      </group>

      <Keyboard />
      <Mouse />
      <group position={[deskWidth / 2 - 0.22, POD.DESK_TOP_Y, POD.DESK_CENTER_Z + 0.2]} rotation={[0, -1.1, 0]}>
        <DeskLamp on />
      </group>
      <group position={[-deskWidth / 2 + 0.2, POD.DESK_TOP_Y, POD.DESK_CENTER_Z - 0.05]}>
        <Mug color={["#e8e4dc", "#c8553d", "#3d6fb3", "#2f2f35"][seed % 4]} />
      </group>
      <group position={[0, 0, -0.03]}>
        <ErgoChair style={CHAIR} />
      </group>
      <group>
        <EmployeeModel accent={slot.accent} pose="seated" activity={state === "WORKING" ? "working" : "idle"} seed={seed} reduced={reduced} />
      </group>

      <mesh
        position={[0, 0.85, 0.2]}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          onFocus();
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
        <boxGeometry args={[1.7, 1.7, 1.9]} />
        <meshBasicMaterial />
      </mesh>

      <Html position={[0, 1.85, 0.4]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            borderRadius: 999,
            background: selected ? "rgba(232,40,63,0.92)" : "rgba(10,13,20,0.82)",
            border: `1px solid ${selected ? "#ff7a8b" : "rgba(255,255,255,0.14)"}`,
            color: "#f1f4fa",
            fontFamily: "ui-sans-serif, system-ui",
            fontSize: 11,
            fontWeight: 650,
            whiteSpace: "nowrap",
            opacity: dimmedByFocus ? 0.25 : 1,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATE_COLOR[state], boxShadow: state === "WORKING" ? `0 0 8px ${WORK_BLUE}` : "none" }} />
          {slot.name}
        </div>
      </Html>
    </group>
  );
});
