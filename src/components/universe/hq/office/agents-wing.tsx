"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { OfficeShell } from "./office-shell";
import { AgentDesk } from "./agent-desk";
import { AgentsBoard, type AgentsBoardStats } from "./agents-board";
import { TallPlant } from "./office-props";
import { RoundedBox } from "@react-three/drei";
import { MergeStatic } from "../render/merge-static";
import type { AgentPodLayout } from "./office-layout";
import { toWorld } from "../life/geometry";
import type { HqPlan } from "../plan/hq-plan";
import { useCameraStore } from "@/store/camera-store";
import type { AgentSessionView } from "@/server/claude/agent-service";

export interface AgentEntry {
  session: AgentSessionView;
  name: string;
  accent: string;
}

interface AgentsWingProps {
  plan: HqPlan;
  agentsLayout: AgentPodLayout;
  entries: AgentEntry[];
  stats: AgentsBoardStats;
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

/** Sala de projeto: caixa de vidro (aberta no teto) com mesa de reunião, cadeiras e um painel — encostada na parede de fundo. */
export function ProjectRoom({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const H = 2.5;
  const glass = <meshPhysicalMaterial color="#cfe3ff" transparent opacity={0.16} roughness={0.04} clearcoat={1} envMapIntensity={1.4} depthWrite={false} side={THREE.DoubleSide} />;
  const steel = <meshStandardMaterial color="#8d95a3" metalness={0.9} roughness={0.3} />;
  const doorW = 1.0;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.008, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#2c3340" roughness={0.9} />
      </mesh>
      {/* lados e frente (com porta) */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * w) / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[d, H]} />
          {glass}
        </mesh>
      ))}
      {[{ cx: -(w / 2 + doorW / 2) / 2 - doorW / 4, len: w / 2 - doorW / 2 }, { cx: (w / 2 + doorW / 2) / 2 + doorW / 4, len: w / 2 - doorW / 2 }].map((seg, i) => (
        <mesh key={i} position={[seg.cx, H / 2, d / 2]}>
          <planeGeometry args={[seg.len, H]} />
          {glass}
        </mesh>
      ))}
      {[[-w / 2, d / 2], [w / 2, d / 2], [-doorW / 2, d / 2], [doorW / 2, d / 2], [-w / 2, -d / 2], [w / 2, -d / 2]].map(([px, pz], i) => (
        <mesh key={i} position={[px, H / 2, pz]} castShadow>
          <boxGeometry args={[0.05, H, 0.05]} />
          {steel}
        </mesh>
      ))}
      <mesh position={[0, H, d / 2]}>
        <boxGeometry args={[w + 0.05, 0.05, 0.05]} />
        {steel}
      </mesh>
      {/* mesa de reunião de madeira e quatro cadeiras */}
      <mesh position={[0, 0.74, 0.1]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.05, 0.95]} />
        <meshStandardMaterial color="#c8a47a" roughness={0.55} />
      </mesh>
      {[-0.8, 0.8].map((lx) => (
        <mesh key={lx} position={[lx, 0.37, 0.1]} castShadow>
          <boxGeometry args={[0.06, 0.74, 0.8]} />
          <meshStandardMaterial color="#1b1e25" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}
      {[[-0.5, 0.85], [0.5, 0.85], [-0.5, -0.65], [0.5, -0.65]].map(([cx, cz], i) => (
        <group key={i} position={[cx, 0, cz]} rotation={[0, cz > 0 ? Math.PI : 0, 0]}>
          <mesh position={[0, 0.46, 0]} castShadow>
            <boxGeometry args={[0.46, 0.08, 0.46]} />
            <meshStandardMaterial color="#2a2f38" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.72, -0.2]} castShadow>
            <boxGeometry args={[0.44, 0.5, 0.06]} />
            <meshStandardMaterial color="#2a2f38" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.44, 8]} />
            <meshStandardMaterial color="#8d95a3" metalness={0.9} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* painel na parede de fundo da sala */}
      <mesh position={[0, 1.55, -d / 2 + 0.06]}>
        <boxGeometry args={[1.5, 0.85, 0.04]} />
        <meshStandardMaterial color="#0b0d12" emissive="#14304a" emissiveIntensity={0.7} metalness={0.5} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** Um agrupamento de mesas: tapete, divisória de vidro entre as duplas e postes de aço. */
function PodDecor({ x, z, yaw }: { x: number; z: number; yaw: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <MergeStatic>
      <RoundedBox args={[4.0, 0.012, 5.0]} radius={0.04} smoothness={2} position={[0, 0.008, 0]} receiveShadow>
        <meshStandardMaterial color="#232832" roughness={1} />
      </RoundedBox>
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[3.7, 1.05, 0.025]} />
        <meshPhysicalMaterial color="#cfe3ff" transparent opacity={0.16} roughness={0.04} clearcoat={1} envMapIntensity={1.4} depthWrite={false} />
      </mesh>
      {[-1.85, 0, 1.85].map((px) => (
        <mesh key={px} position={[px, 0.58, 0]} castShadow>
          <boxGeometry args={[0.05, 1.12, 0.05]} />
          <meshStandardMaterial color="#8d95a3" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 1.145, 0]}>
        <boxGeometry args={[3.74, 0.03, 0.05]} />
        <meshStandardMaterial color="#8d95a3" metalness={0.9} roughness={0.3} />
      </mesh>
      </MergeStatic>
    </group>
  );
}

/**
 * Ala Operacional (agentes). Os personagens são os MESMOS da sala de trabalho: a simulação visual decide se
 * ficam na mesa ou passeiam pelo átrio a partir do estado real — e nunca escreve de volta.
 */
export function AgentsWing({ plan, agentsLayout, entries, stats, selectedAgentId, onSelectAgent, reducedGraphics }: AgentsWingProps) {
  const focusProject = useCameraStore((s) => s.focusProject);
  const focusId = useCameraStore((s) => s.focusId);
  const cameraMode = useCameraStore((s) => s.mode);
  const ag = plan.wings.agents;

  const byId = useMemo(() => new Map(entries.map((e) => [e.session.id, e])), [entries]);

  return (
    <>
      {/* Ala Operacional — girada, em seu próprio nível */}
      <group position={[ag.x, ag.level, ag.z]} rotation={[0, ag.rot, 0]}>
        <OfficeShell layout={agentsLayout} doorSide="east" doorZ={agentsLayout.aisleZ} wallHeight={ag.wallHeight} tint="#cfd3db" tower={{ side: 1, extra: 1.2 }} />
        <AgentsBoard layout={agentsLayout} stats={stats} />
        {[-1, 1].map((sd) => (
          <group key={sd} position={[sd * (agentsLayout.width / 2 - 0.9), 0, -agentsLayout.depth / 2 + 0.9]}>
            <TallPlant scale={0.95} />
          </group>
        ))}
        {agentsLayout.rooms.map((r, i) => (
          <ProjectRoom key={i} {...r} />
        ))}
        {agentsLayout.pods.map((pod) => (
          <PodDecor key={pod.index} x={pod.x} z={pod.z} yaw={pod.yaw} />
        ))}
      </group>
      {agentsLayout.desks.map((slot) => {
        const entry = byId.get(slot.projectId);
        if (!entry) return null;
        const wp = toWorld(ag, { x: slot.x, z: slot.z });
        const worldSlot = { ...slot, x: wp.x, z: wp.z };
        return (
          <AgentDesk
            key={slot.projectId}
            slot={worldSlot}
            session={entry.session}
            selected={selectedAgentId === slot.projectId}
            dimmedByFocus={focusId !== null && cameraMode !== "overview" && cameraMode !== "free" && focusId !== slot.projectId}
            reduced={reducedGraphics}
            yaw={(slot.yaw ?? 0) + ag.rot}
            level={ag.level}
            onFocus={() => {
              onSelectAgent(slot.projectId);
              focusProject(slot.projectId, [wp.x, 1.0 + ag.level, wp.z], 2.6, `Agente · ${slot.name}`);
            }}
          />
        );
      })}

      {/* navegação: portas e áreas */}
      <Html position={[ag.door.x, 3.2, ag.door.z]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={() => focusProject("agents-room", [ag.x, 1.0 + ag.level, ag.z], Math.max(ag.width, ag.depth) * 0.45, "Ala Operacional")}
          style={pill(stats.approvals > 0)}
        >
          Ala Operacional · {stats.approvals > 0 ? `${stats.approvals} aguardando aprovação` : stats.working > 0 ? `${stats.working} trabalhando` : `${stats.active} ativo${stats.active === 1 ? "" : "s"}`}
        </button>
      </Html>
    </>
  );
}
