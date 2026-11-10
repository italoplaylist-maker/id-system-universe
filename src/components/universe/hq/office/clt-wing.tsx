"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import { OfficeShell } from "./office-shell";
import { AgentDesk } from "./agent-desk";
import { ProjectRoom } from "./agents-wing";
import { TallPlant } from "./office-props";
import { MergeStatic } from "../render/merge-static";
import type { OfficeLayout } from "./office-layout";
import { toWorld } from "../life/geometry";
import type { HqPlan } from "../plan/hq-plan";
import type { CltLayout } from "../plan/clt-layout";
import { useCameraStore } from "@/store/camera-store";
import type { AgentSessionView } from "@/server/claude/agent-service";

export interface CltEntry {
  session: AgentSessionView;
  name: string;
  accent: string;
}

interface CltWingProps {
  plan: HqPlan;
  shellLayout: OfficeLayout;
  layout: CltLayout;
  entries: CltEntry[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  reducedGraphics: boolean;
}

const pill = (hot: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: 999,
  background: hot ? "rgba(120,80,0,0.92)" : "rgba(10,13,20,0.85)",
  border: hot ? "1px solid #fbbf24" : "1px solid rgba(255,255,255,0.18)",
  color: "#f1f4fa",
  fontFamily: "ui-sans-serif, system-ui",
  fontSize: 11,
  fontWeight: 650,
  whiteSpace: "nowrap",
  cursor: "pointer",
});

const RED = "#e8283f";

/** Mesa de supervisão: tampo circular escuro com anel de LED e um holograma que gira devagar (parado em gráficos reduzidos). */
function SupervisionTable({ x, z, r, reduced }: { x: number; z: number; r: number; reduced: boolean }) {
  const holo = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!reduced && holo.current) holo.current.rotation.y = clock.elapsedTime * 0.35;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r + 1.1, 48]} />
        <meshStandardMaterial color="#1b2029" roughness={1} />
      </mesh>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 0.82, 0.76, 40]} />
        <meshStandardMaterial color="#10141b" roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.78, r * 0.86, 48]} />
        <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={1.2} toneMapped={false} />
      </mesh>
      <group ref={holo} position={[0, 1.35, 0]}>
        <mesh>
          <icosahedronGeometry args={[0.38, 1]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.9} wireframe toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.62, 0.012, 8, 48]} />
          <meshStandardMaterial color="#e6e9f0" emissive="#e6e9f0" emissiveIntensity={0.6} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Espaço de descanso: tapete, dois sofás, mesa de centro e planta (decoração — sem simulação de uso). */
function RestArea({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const sofa = (px: number, pz: number, ry: number, key: string) => (
    <group key={key} position={[px, 0, pz]} rotation={[0, ry, 0]}>
      <RoundedBox args={[1.9, 0.42, 0.86]} radius={0.06} smoothness={2} position={[0, 0.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#3a4150" roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[1.9, 0.5, 0.2]} radius={0.06} smoothness={2} position={[0, 0.62, -0.33]} castShadow>
        <meshStandardMaterial color="#323847" roughness={0.85} />
      </RoundedBox>
    </group>
  );
  return (
    <group position={[x, 0, z]}>
      <MergeStatic>
        <RoundedBox args={[w, 0.012, d]} radius={0.04} smoothness={2} position={[0, 0.008, 0]} receiveShadow>
          <meshStandardMaterial color="#2a303b" roughness={1} />
        </RoundedBox>
        {sofa(0, -d / 2 + 0.7, 0, "s1")}
        {sofa(0, d / 2 - 0.7, Math.PI, "s2")}
        <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.4, 24]} />
          <meshStandardMaterial color="#c8a47a" roughness={0.55} />
        </mesh>
      </MergeStatic>
      <group position={[w / 2 - 0.4, 0, 0]}>
        <TallPlant scale={0.9} />
      </group>
    </group>
  );
}

/**
 * Sala AGENTES CLT: estações em ferradura voltadas para a mesa de supervisão, sala de reunião de vidro e espaço de
 * descanso. Cada estação é um agente REAL do orquestrador (estado, tarefa e consumo vêm das tarefas); mesa vazia = vaga.
 */
export function CltWing({ plan, shellLayout, layout, entries, selectedAgentId, onSelectAgent, reducedGraphics }: CltWingProps) {
  const focusProject = useCameraStore((s) => s.focusProject);
  const focusId = useCameraStore((s) => s.focusId);
  const cameraMode = useCameraStore((s) => s.mode);
  const clt = plan.wings.clt;
  const working = entries.filter((e) => e.session.state === "WORKING").length;
  const approvals = entries.filter((e) => e.session.state === "APPROVAL").length;
  const pending = useMemo(() => entries.map((e, i) => ({ entry: e, station: layout.stations[i] })).filter((p) => p.station), [entries, layout.stations]);

  return (
    <>
      <group position={[clt.x, clt.level, clt.z]} rotation={[0, clt.rot, 0]}>
        <OfficeShell layout={shellLayout} doorSide="east" doorZ={layout.doorZ} screenPanel={false} wallHeight={clt.wallHeight} tint="#cfd3db" tower={{ side: 1, extra: 1.2 }} />
        <SupervisionTable x={layout.table.x} z={layout.table.z} r={layout.table.r} reduced={reducedGraphics} />
        <ProjectRoom x={layout.meeting.x} z={layout.meeting.z} w={layout.meeting.w} d={layout.meeting.d} />
        <RestArea x={layout.rest.x} z={layout.rest.z} w={layout.rest.w} d={layout.rest.d} />
        {layout.plants.map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]}>
            <TallPlant scale={0.95} />
          </group>
        ))}
      </group>

      {pending.map(({ entry, station }) => {
        const wp = toWorld(clt, { x: station.x, z: station.z });
        const slot = { projectId: entry.session.id, name: entry.name, accent: entry.accent, x: wp.x, z: wp.z, row: 0, col: station.index };
        return (
          <AgentDesk
            key={entry.session.id}
            slot={slot}
            session={entry.session}
            selected={selectedAgentId === entry.session.id}
            dimmedByFocus={focusId !== null && cameraMode !== "overview" && cameraMode !== "free" && focusId !== entry.session.id}
            reduced={reducedGraphics}
            yaw={station.yaw + clt.rot}
            level={clt.level}
            onFocus={() => {
              onSelectAgent(entry.session.id);
              focusProject(entry.session.id, [wp.x, 1.0 + clt.level, wp.z], 2.6, `Agente CLT · ${entry.name}`);
            }}
          />
        );
      })}

      <Html position={[clt.door.x, 3.2, clt.door.z]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={() => focusProject("clt-room", [clt.x, 1.0 + clt.level, clt.z], Math.max(clt.width, clt.depth) * 0.45, "AGENTES CLT")}
          style={pill(approvals > 0)}
        >
          AGENTES CLT · {entries.length === 0 ? "equipe não criada" : approvals > 0 ? `${approvals} aguardando aprovação` : working > 0 ? `${working} trabalhando` : `${entries.length} disponíve${entries.length === 1 ? "l" : "is"}`}
        </button>
      </Html>
    </>
  );
}
