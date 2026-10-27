"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { EmployeeModel } from "../assets/employee-model";
import { ErgoChair, Keyboard, Mouse, DeskLamp, Mug, Notebook, PotPlant, PodMonitor, POD, type ChairStyle } from "./pod-furniture";
import { hashSeed } from "../assets/office-decor";
import { PALETTE } from "../palette";
import type { DeskSlot } from "./office-layout";
import type { UniverseApplication } from "@/types/domain";

export type DeskState = "OFF" | "IDLE" | "WORKING" | "ERROR";

const WORK_BLUE = "#1f7bff";
const ERROR_RED = "#ff5a5f";
const OAK = new THREE.Color("#c8a47a");
const OAK_OFF = new THREE.Color("#4a4036");
const BLUE = new THREE.Color(WORK_BLUE);
const RED = new THREE.Color(ERROR_RED);

const CHAIR_STYLES: ChairStyle[] = [
  { fabric: "#2b303b", headrest: false },
  { fabric: "#38404f", headrest: true },
  { fabric: "#3a3f45", headrest: false },
  { fabric: "#24384a", headrest: true },
];

const STATUS_LABEL: Record<UniverseApplication["status"], string> = {
  RUNNING: "RODANDO",
  STOPPED: "PARADO",
  DEPLOYING: "IMPLANTANDO",
  ERROR: "ERRO",
  UNKNOWN: "DESCONHECIDO",
};
const STATUS_COLOR: Record<UniverseApplication["status"], string> = {
  RUNNING: "#34d399",
  STOPPED: "#6b7280",
  DEPLOYING: "#38bdf8",
  ERROR: "#f87171",
  UNKNOWN: "#8890a3",
};
const TYPE_LABEL: Record<UniverseApplication["resourceType"], string> = { APPLICATION: "APLICAÇÃO", SERVICE: "SERVIÇO", DATABASE: "BANCO DE DADOS" };

/** What the desk does for the project's real state — derived from real resource data, never invented. */
export function deskStateFor(resources: UniverseApplication[]): DeskState {
  if (resources.some((r) => r.pendingOperation !== null || r.status === "DEPLOYING")) return "WORKING";
  if (resources.some((r) => r.status === "ERROR")) return "ERROR";
  if (resources.length > 0 && resources.every((r) => r.status === "STOPPED")) return "OFF";
  return "IDLE";
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function formatDeploy(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function paintResource(ctx: CanvasRenderingContext2D, w: number, h: number, resource: UniverseApplication, accent: string) {
  const color = STATUS_COLOR[resource.status];
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
  ctx.fillText(TYPE_LABEL[resource.resourceType], 24, 30);
  ctx.fillStyle = "#f2f5fb";
  ctx.font = "700 27px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, resource.name, w - 48), 24, 66);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(34, 104, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "800 24px ui-sans-serif, system-ui";
  ctx.fillText(STATUS_LABEL[resource.status], 54, 113);

  if (resource.status === "DEPLOYING" || resource.pendingOperation) {
    ctx.fillStyle = "#16233a";
    ctx.fillRect(24, 132, w - 48, 10);
    ctx.fillStyle = "#38bdf8";
    for (let x = 24; x < w - 24; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 142);
      ctx.lineTo(x + 12, 132);
      ctx.lineTo(x + 24, 132);
      ctx.lineTo(x + 12, 142);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.fillStyle = "#8f9bb3";
  ctx.font = "500 14px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, `Servidor: ${resource.providerName}`, w - 48), 24, 168);
  ctx.fillText(fit(ctx, `Branch: ${resource.branch ?? "—"}   ·   Deploy: ${formatDeploy(resource.lastDeployedAt)}`, w - 48), 24, 192);
}

function paintEmpty(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, accent: string, extra: number) {
  ctx.fillStyle = "#0a0e17";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 6, h);
  ctx.fillStyle = "#e6ebf5";
  ctx.font = "700 26px ui-sans-serif, system-ui";
  ctx.fillText(fit(ctx, name, w - 48), 24, 86);
  ctx.fillStyle = "#7d889d";
  ctx.font = "600 17px ui-sans-serif, system-ui";
  ctx.fillText(extra > 0 ? `+${extra} recurso${extra === 1 ? "" : "s"}` : "SEM RECURSOS", 24, 122);
}

const ResourceMonitor = memo(function ResourceMonitor({
  resource,
  extra,
  projectName,
  accent,
  x,
  yaw,
  width,
  off,
  onClick,
}: {
  resource: UniverseApplication | null;
  extra: number;
  projectName: string;
  accent: string;
  x: number;
  yaw: number;
  width: number;
  off: boolean;
  onClick?: () => void;
}) {
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      if (resource) paintResource(ctx, w, h, resource, accent);
      else paintEmpty(ctx, w, h, projectName, accent, extra);
    },
    [resource, projectName, accent, extra],
  );
  const key = resource
    ? `${resource.id}|${resource.name}|${resource.status}|${resource.pendingOperation}|${resource.lastDeployedAt}|${resource.branch}|${resource.providerName}`
    : `empty|${projectName}|${extra}`;
  const pivotZ = POD.DESK_CENTER_Z + 0.24;
  return (
    <group position={[x, 0, pivotZ]} rotation={[0, yaw, 0]}>
      <group position={[0, 0, -pivotZ]}>
        <PodMonitor width={width} paint={paint} paintKey={key} off={off} accent={accent} onClick={onClick} />
      </group>
    </group>
  );
});

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

interface ProjectDeskProps {
  slot: DeskSlot;
  resources: UniverseApplication[];
  state: DeskState;
  statusLabel: string;
  statusColor: string;
  selected: boolean;
  /** Another desk is the camera's focus — this nameplate steps back. */
  dimmedByFocus: boolean;
  reduced: boolean;
  onFocusProject: () => void;
  onSelectResource: (id: string) => void;
  onFocusResource: (id: string, worldPosition: [number, number, number], name: string) => void;
}

/**
 * One project = one workstation: desk, ergonomic chair, up to three live monitors (one per
 * resource, real status), keyboard/mouse/lamp and ONE employee. Idle → calm; a real
 * deploy/operation in flight → the desk turns blue and the employee types; error → soft red;
 * every resource stopped → lights out, chair pushed back, nobody at the desk. All transitions
 * are damped (~250–350 ms), never snapped.
 */
export const ProjectDesk = memo(function ProjectDesk({ slot, resources, state, statusLabel, statusColor, selected, dimmedByFocus, reduced, onFocusProject, onSelectResource, onFocusResource }: ProjectDeskProps) {
  const [hovered, setHovered] = useState(false);
  const seed = useMemo(() => hashSeed(slot.projectId), [slot.projectId]);
  const chairStyle = CHAIR_STYLES[seed % CHAIR_STYLES.length];
  const off = state === "OFF";

  const monitorCount = Math.min(3, Math.max(1, resources.length));
  const deskWidth = monitorCount === 1 ? 1.5 : monitorCount === 2 ? 1.75 : 2.1;
  const monitorWidth = monitorCount === 3 ? 0.5 : 0.58;
  const monitorXs = monitorCount === 1 ? [0] : monitorCount === 2 ? [-0.3, 0.3] : [-0.53, 0, 0.53];
  const monitorYaws = monitorCount === 1 ? [0] : monitorCount === 2 ? [-0.2, 0.2] : [-0.32, 0, 0.32];
  const hiddenResources = Math.max(0, resources.length - 3);

  const topMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const stripMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const haloMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const chairGroup = useRef<THREE.Group>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const podWorld = useRef(new THREE.Vector3());
  const plateScale = useRef(1);
  const plateDetailRef = useRef<HTMLSpanElement>(null);
  const blend = useRef({ work: state === "WORKING" ? 1 : 0, error: state === "ERROR" ? 1 : 0, power: off ? 0 : 1, ring: 0, away: off ? 1 : 0 });
  const tmp = useRef(new THREE.Color());

  useFrame(({ clock, camera }, delta) => {
    const dt = Math.min(delta, 0.05);
    const b = blend.current;

    // Nameplate stays readable at any zoom: it scales gently with camera distance instead of growing with it.
    const plate = plateRef.current;
    if (plate) {
      podWorld.current.set(slot.x, 1.8, slot.z);
      const next = THREE.MathUtils.clamp(15 / camera.position.distanceTo(podWorld.current), 0.72, 1.1);
      if (Math.abs(next - plateScale.current) > 0.02) {
        plateScale.current = next;
        plate.style.transform = `scale(${next})`;
        // Far away (Overview) only the name is shown; the status text appears once you're closer.
        if (plateDetailRef.current) plateDetailRef.current.style.display = next > 0.9 ? "inline" : "none";
      }
    }
    b.work = damp(b.work, state === "WORKING" ? 1 : 0, 6, dt);
    b.error = damp(b.error, state === "ERROR" ? 1 : 0, 6, dt);
    b.power = damp(b.power, off ? 0 : 1, 5, dt);
    b.away = damp(b.away, off ? 1 : 0, 4, dt);
    b.ring = damp(b.ring, selected ? 1 : hovered ? 0.55 : 0, 10, dt);

    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4);
    const glow = Math.max(b.work, b.error);
    if (topMaterial.current) {
      tmp.current.copy(OAK).lerp(OAK_OFF, 1 - b.power).lerp(b.error > b.work ? RED : BLUE, glow * 0.85);
      topMaterial.current.color.copy(tmp.current);
      topMaterial.current.emissive.copy(b.error > b.work ? RED : BLUE);
      topMaterial.current.emissiveIntensity = glow * (0.55 + 0.3 * pulse);
    }
    if (stripMaterial.current) {
      stripMaterial.current.emissive.copy(glow > 0.05 ? (b.error > b.work ? RED : BLUE) : tmp.current.set(slot.accent));
      stripMaterial.current.emissiveIntensity = (0.35 + glow * (1.1 + 0.5 * pulse)) * b.power;
    }
    if (haloMaterial.current) haloMaterial.current.opacity = glow * (0.28 + 0.14 * pulse);
    if (ringMaterial.current) ringMaterial.current.opacity = b.ring * 0.85;
    if (chairGroup.current) {
      const wiggle = reduced ? 0 : Math.sin(clock.elapsedTime * 0.7 + seed) * 0.05 * b.work;
      chairGroup.current.position.z = -0.03 - b.away * 0.42;
      chairGroup.current.rotation.y = wiggle + b.away * 0.85;
    }
  });

  const showEmployee = !off;
  const mugColor = ["#e8e4dc", "#c8553d", "#3d6fb3", "#2f2f35"][seed % 4];
  const monitorsOff = off;

  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, Math.PI, 0]}>
      {/* carpet pad defining the pod */}
      <RoundedBox args={[2.7, 0.012, 2.45]} radius={0.04} smoothness={2} position={[0, 0.006, 0.45]} receiveShadow>
        <meshStandardMaterial color="#2a303c" roughness={1} />
      </RoundedBox>
      <mesh position={[0, 0.0125, 0.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.28, 1.34, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color={slot.accent} transparent opacity={0.0} />
      </mesh>
      {/* state halo (blue = working / red = error) and hover/selection ring */}
      <mesh position={[0, 0.016, 0.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.6, 40]} />
        <meshBasicMaterial ref={haloMaterial} color={WORK_BLUE} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.42, 1.5, 48]} />
        <meshBasicMaterial ref={ringMaterial} color={PALETTE.brand} transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* desk */}
      <RoundedBox args={[deskWidth, POD.DESK_THICKNESS, POD.DESK_DEPTH]} radius={0.016} smoothness={3} position={[0, POD.DESK_TOP_Y - POD.DESK_THICKNESS / 2, POD.DESK_CENTER_Z]} castShadow receiveShadow>
        <meshStandardMaterial ref={topMaterial} color="#c8a47a" roughness={0.55} metalness={0.02} />
      </RoundedBox>
      {/* front edge LED strip */}
      <mesh position={[0, POD.DESK_TOP_Y - 0.052, POD.DESK_CENTER_Z - POD.DESK_DEPTH / 2 + 0.012]}>
        <boxGeometry args={[deskWidth - 0.04, 0.012, 0.012]} />
        <meshStandardMaterial ref={stripMaterial} color="#0b0d12" emissive={slot.accent} emissiveIntensity={0.35} />
      </mesh>
      {/* steel frame: side legs + cross rail + modesty panel */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (deskWidth / 2 - 0.07), 0, POD.DESK_CENTER_Z]}>
          <mesh position={[0, (POD.DESK_TOP_Y - POD.DESK_THICKNESS) / 2, 0]} castShadow>
            <boxGeometry args={[0.045, POD.DESK_TOP_Y - POD.DESK_THICKNESS, 0.045]} />
            <meshStandardMaterial color="#1b1e25" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.015, 0]} castShadow>
            <boxGeometry args={[0.05, 0.03, POD.DESK_DEPTH - 0.1]} />
            <meshStandardMaterial color="#1b1e25" metalness={0.7} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.5, POD.DESK_CENTER_Z + POD.DESK_DEPTH / 2 - 0.05]} castShadow>
        <boxGeometry args={[deskWidth - 0.2, 0.38, 0.02]} />
        <meshStandardMaterial color="#e6e3dc" roughness={0.8} />
      </mesh>

      {/* monitors — one per resource, real status */}
      {monitorXs.map((mx, i) => {
        const isOverflowSlot = i === 2 && hiddenResources > 0;
        const resource = isOverflowSlot ? null : (resources[i] ?? null);
        return (
          <ResourceMonitor
            key={i}
            resource={resource}
            extra={isOverflowSlot ? hiddenResources + 1 : 0}
            projectName={slot.name}
            accent={slot.accent}
            x={mx}
            yaw={monitorYaws[i]}
            width={monitorWidth}
            off={monitorsOff}
            onClick={
              resource
                ? () => {
                    onSelectResource(resource.id);
                    onFocusResource(resource.id, [slot.x - mx, 1.05, slot.z - (POD.DESK_CENTER_Z + 0.24)], resource.name);
                  }
                : undefined
            }
          />
        );
      })}

      <Keyboard />
      <Mouse />
      <group position={[deskWidth / 2 - 0.22, POD.DESK_TOP_Y, POD.DESK_CENTER_Z + 0.2]} rotation={[0, -1.1, 0]}>
        <DeskLamp on={!off} />
      </group>
      <group position={[-deskWidth / 2 + 0.2, POD.DESK_TOP_Y, POD.DESK_CENTER_Z - 0.05]}>
        <Mug color={mugColor} />
      </group>
      {seed % 3 === 0 && (
        <group position={[-deskWidth / 2 + 0.2, POD.DESK_TOP_Y, POD.DESK_CENTER_Z + 0.22]} rotation={[0, 0.3, 0]}>
          <Notebook color={slot.accent} />
        </group>
      )}
      {seed % 3 === 1 && (
        <group position={[-deskWidth / 2 + 0.17, POD.DESK_TOP_Y, POD.DESK_CENTER_Z + 0.25]}>
          <PotPlant scale={0.9} />
        </group>
      )}

      {/* chair + employee */}
      <group ref={chairGroup} position={[0, 0, -0.03]}>
        <ErgoChair style={chairStyle} />
      </group>
      {showEmployee && (
        <group position={[0, 0, 0.0]}>
          <EmployeeModel accent={slot.accent} pose="seated" activity={state === "WORKING" ? "working" : "idle"} seed={seed} reduced={reduced} />
        </group>
      )}

      {/* hit areas — click focuses the project, hover lights the ring. Two low boxes (the person/chair zone and the desk surface) so the monitors above the desk stay individually clickable. */}
      {(
        [
          { position: [0, 0.85, -0.1] as [number, number, number], size: [1.5, 1.7, 1.1] as [number, number, number] },
          { position: [0, 0.4, POD.DESK_CENTER_Z] as [number, number, number], size: [deskWidth, 0.8, POD.DESK_DEPTH] as [number, number, number] },
        ] as const
      ).map((zone, i) => (
        <mesh
          key={i}
          position={zone.position}
          visible={false}
          onClick={(e) => {
            e.stopPropagation();
            onFocusProject();
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
          <boxGeometry args={zone.size} />
          <meshBasicMaterial />
        </mesh>
      ))}

      {/* name plate — a small tag, physically above the desk (rotated back to face the camera side) */}
      <Html position={[0, 1.85, 0.4]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div
          ref={plateRef}
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
            opacity: dimmedByFocus ? 0.25 : off ? 0.6 : 1,
            transition: "background 200ms cubic-bezier(0.23,1,0.32,1), border-color 200ms cubic-bezier(0.23,1,0.32,1), opacity 200ms cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: state === "WORKING" ? WORK_BLUE : statusColor, boxShadow: state === "WORKING" ? `0 0 8px ${WORK_BLUE}` : "none" }} />
          {slot.name}
          <span ref={plateDetailRef} style={{ display: "none", color: state === "WORKING" ? "#9fd1ff" : "#9aa5bb", fontWeight: 500 }}>
            · {state === "WORKING" ? "trabalhando" : statusLabel}
          </span>
        </div>
      </Html>
    </group>
  );
});
