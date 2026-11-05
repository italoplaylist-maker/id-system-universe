"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { applyLabelFade, labelOpacity } from "./label-fade";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { ErgoChair, Keyboard, Mouse, DeskLamp, Mug, PodMonitor, POD, type ChairStyle } from "./pod-furniture";
import { hashSeed } from "../assets/office-decor";
import { PALETTE } from "../palette";
import type { DeskSlot } from "./office-layout";
import { useLife } from "../life/life-context";
import { deskChairAway } from "../life/policy";
import type { AgentSessionView } from "@/server/claude/agent-service";

const WORK_BLUE = "#1f7bff";
const ERROR_RED = "#ff5a5f";
const OAK = new THREE.Color("#c8a47a");
const BLUE = new THREE.Color(WORK_BLUE);
const RED = new THREE.Color(ERROR_RED);
const AMBER = new THREE.Color("#fbbf24");
const CHAIR: ChairStyle = { fabric: "#2b303b", headrest: true };

const STATE_LABEL = { WORKING: "TRABALHANDO", IDLE: "AGUARDANDO", ERROR: "ERRO NA FERRAMENTA", APPROVAL: "AGUARDA SUA APROVAÇÃO" } as const;
const STATE_COLOR = { WORKING: "#38bdf8", IDLE: "#8890a3", ERROR: "#f87171", APPROVAL: "#fbbf24" } as const;

const ROOM_LABEL = { AVAILABLE: "DISPONÍVEL", RECEIVING: "COMANDO RECEBIDO", RUNNING: "EXECUTANDO", WAITING: "AGUARDA SUA APROVAÇÃO", DONE: "CONCLUÍDO", ERROR: "ERRO", PAUSED: "PAUSADO" } as const;
const ROOM_COLOR = { AVAILABLE: "#34d399", RECEIVING: "#60a5fa", RUNNING: "#38bdf8", WAITING: "#fbbf24", DONE: "#4ade80", ERROR: "#f87171", PAUSED: "#8890a3" } as const;

export function agentTitle(s: Pick<AgentSessionView, "repo" | "id"> & { profile?: AgentSessionView["profile"] }): string {
  if (s.profile) return s.profile.title;
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

  ctx.fillStyle = s.profile ? ROOM_COLOR[s.profile.roomState] : STATE_COLOR[s.state];
  ctx.beginPath();
  ctx.arc(34, 114, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "800 22px ui-sans-serif, system-ui";
  ctx.fillText(s.profile ? ROOM_LABEL[s.profile.roomState] : STATE_LABEL[s.state], 54, 122);
  ctx.font = "800 15px ui-sans-serif, system-ui";

  ctx.fillStyle = "#e6ebf5";
  ctx.font = "600 17px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, s.approval ? `${s.approval.tool} · ${s.approval.detail}` : (s.activity ?? (s.profile ? "Pronto para receber comandos" : "Sem atividade ainda")), w - 48), 24, 156);
  ctx.fillStyle = "#7d889d";
  ctx.font = "500 14px ui-sans-serif, system-ui";
  ctx.fillText(s.profile ? (s.profile.queued > 0 ? `${s.profile.queued} na fila` : "Fila vazia") : `${s.toolCount} ferramentas · ${s.failedCount} falhas · ${hhmm(s.lastEventAt)}`, 24, 190);
}

// Geometrias/materiais compartilhados: todas as estações usam os mesmos (sem alocar por mesa).
const TOWER_GEO = new THREE.BoxGeometry(0.2, 0.42, 0.44);
const CABLE_GEO = new THREE.CylinderGeometry(0.006, 0.006, 1, 6);
const TOWER_MAT = new THREE.MeshStandardMaterial({ color: "#1d2129", roughness: 0.55, metalness: 0.45 });
const CABLE_MAT = new THREE.MeshStandardMaterial({ color: "#14161b", roughness: 0.9 });
const LED_GREEN = new THREE.Color("#34d399");
const LED_OFF = new THREE.Color("#3a3f4a");

/** Torre do PC sob a mesa: o LED reflete o estado real do agente (verde disponível, azul executando, âmbar aguardando, vermelho erro). */
function PcTower({ x, z, ledRef }: { x: number; z: number; ledRef: React.RefObject<THREE.MeshBasicMaterial | null> }) {
  return (
    <group position={[x, 0.21, z]}>
      <mesh geometry={TOWER_GEO} material={TOWER_MAT} castShadow />
      <mesh position={[0, 0.13, 0.221]}>
        <boxGeometry args={[0.1, 0.02, 0.004]} />
        <meshStandardMaterial color="#0c0e12" />
      </mesh>
      <mesh position={[0.07, 0.17, 0.222]}>
        <sphereGeometry args={[0.009, 8, 6]} />
        <meshBasicMaterial ref={ledRef} color={LED_GREEN} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Cabo fino entre dois pontos (monitor → torre): discreto, sem física. */
function Cable({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const { mid, len, q } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    return { mid: a.clone().add(b).multiplyScalar(0.5), len: a.distanceTo(b), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pontos fixos por mesa
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);
  return <mesh geometry={CABLE_GEO} material={CABLE_MAT} position={mid} quaternion={q} scale={[1, len, 1]} />;
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
  /** Deslocamento X da sala dos agentes no mundo (para medir a distância da câmera). */
  offsetX?: number;
  /** Giro extra da mesa (rad) e altura do piso — mesas em agrupamentos e alas em níveis diferentes. */
  yaw?: number;
  level?: number;
  onFocus: () => void;
}

/** Uma sessão de agente Claude = uma mesa: azul e digitando quando trabalha, vermelha se a última ferramenta falhou, calma quando aguarda. */
export const AgentDesk = memo(function AgentDesk({ slot, session, selected, dimmedByFocus, reduced, offsetX = 0, yaw = 0, level = 0, onFocus }: AgentDeskProps) {
  const life = useLife();
  const [hovered, setHovered] = useState(false);
  const seed = useMemo(() => hashSeed(session.id), [session.id]);
  const state = session.state;
  const deskWidth = 1.5;

  const topMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const haloMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const chairGroup = useRef<THREE.Group>(null);
  const ledMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const blend = useRef({ away: 0, work: state === "WORKING" ? 1 : 0, error: state === "ERROR" ? 1 : 0, ask: state === "APPROVAL" ? 1 : 0, ring: 0 });
  const tmp = useRef(new THREE.Color());

  useFrame(({ clock, camera }, delta) => {
    const dt = Math.min(delta, 0.05);
    const b = blend.current;
    applyLabelFade(fadeRef.current, labelOpacity(camera, slot.x + offsetX, 1.8, slot.z, selected || hovered));
    b.work = damp(b.work, state === "WORKING" ? 1 : 0, 6, dt);
    b.error = damp(b.error, state === "ERROR" ? 1 : 0, 6, dt);
    b.ask = damp(b.ask, state === "APPROVAL" ? 1 : 0, 6, dt);
    b.ring = damp(b.ring, selected ? 1 : hovered ? 0.55 : 0, 10, dt);
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4);
    const glow = Math.max(b.work, b.error, b.ask);
    // Âmbar (aguardando aprovação) tem prioridade visual: é o único estado que depende de você.
    const tint = b.ask > Math.max(b.work, b.error) ? AMBER : b.error > b.work ? RED : BLUE;
    if (topMaterial.current) {
      tmp.current.copy(OAK).lerp(tint, glow * 0.85);
      topMaterial.current.color.copy(tmp.current);
      topMaterial.current.emissive.copy(tint);
      topMaterial.current.emissiveIntensity = glow * (0.55 + 0.3 * pulse);
    }
    // A cadeira sai da mesa quando o agente se levanta e volta quando ele senta de novo.
    const awayTarget = deskChairAway(life?.actors.get(session.id));
    b.away = damp(b.away, awayTarget, 7, dt);
    if (chairGroup.current) {
      chairGroup.current.position.z = -0.03 - b.away * 0.42;
      chairGroup.current.rotation.y = b.away * 0.85;
    }
    if (ledMaterial.current) {
      const room = session.profile?.roomState;
      const target = state === "ERROR" ? RED : state === "APPROVAL" ? AMBER : room === "PAUSED" ? LED_OFF : state === "WORKING" ? BLUE : LED_GREEN;
      // Piscar suave só enquanto executa (representa o backend; em Reduced Graphics fica fixo).
      ledMaterial.current.color.copy(target).multiplyScalar(state === "WORKING" && !reduced ? 0.7 + 0.5 * pulse : 1);
    }
    if (haloMaterial.current) haloMaterial.current.opacity = glow * (0.28 + 0.14 * pulse);
    if (ringMaterial.current) ringMaterial.current.opacity = b.ring * 0.85;
  });

  const paint = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => paintAgent(ctx, w, h, session, slot.accent), [session, slot.accent]);
  const paintKey = `${session.profile?.roomState ?? ""}|${session.profile?.queued ?? ""}|${session.approval?.id ?? ""}|${session.state}|${session.activity}|${session.toolCount}|${session.failedCount}|${session.lastEventAt}|${session.repo}|${session.branch}`;
  const pivotZ = POD.DESK_CENTER_Z + 0.24;

  return (
    <group position={[slot.x, level, slot.z]} rotation={[0, Math.PI + yaw, 0]}>
      <RoundedBox args={[2.3, 0.012, 2.2]} radius={0.04} smoothness={2} position={[0, 0.006, 0.5]} receiveShadow>
        <meshStandardMaterial color="#2a303c" roughness={1} />
      </RoundedBox>
      <mesh position={[0, 0.016, 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.3, 40]} />
        <meshBasicMaterial ref={haloMaterial} color={WORK_BLUE} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.18, 1.25, 48]} />
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

      <PcTower x={deskWidth / 2 - 0.2} z={POD.DESK_CENTER_Z - 0.12} ledRef={ledMaterial} />
      <Cable from={[0.18, POD.DESK_TOP_Y, POD.DESK_CENTER_Z - 0.24]} to={[deskWidth / 2 - 0.2, 0.36, POD.DESK_CENTER_Z - 0.2]} />
      <Cable from={[0.2, POD.DESK_TOP_Y, POD.DESK_CENTER_Z - 0.22]} to={[deskWidth / 2 - 0.14, 0.4, POD.DESK_CENTER_Z - 0.2]} />
      <Keyboard />
      <Mouse />
      <group position={[deskWidth / 2 - 0.22, POD.DESK_TOP_Y, POD.DESK_CENTER_Z + 0.2]} rotation={[0, -1.1, 0]}>
        <DeskLamp on />
      </group>
      <group position={[-deskWidth / 2 + 0.2, POD.DESK_TOP_Y, POD.DESK_CENTER_Z - 0.05]}>
        <Mug color={["#e8e4dc", "#c8553d", "#3d6fb3", "#2f2f35"][seed % 4]} />
      </group>
      <group ref={chairGroup} position={[0, 0, -0.03]}>
        <ErgoChair style={CHAIR} />
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
        <div ref={fadeRef} style={{ visibility: "hidden", opacity: 0, transition: "opacity 160ms ease-out" }}>
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: session.profile ? ROOM_COLOR[session.profile.roomState] : STATE_COLOR[state], boxShadow: state === "WORKING" ? `0 0 8px ${WORK_BLUE}` : "none" }} />
          {slot.name}
        </div>
        </div>
      </Html>
    </group>
  );
});
