"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { OfficeShell, PARTITION_DOOR_WIDTH, partitionDoorZ } from "./office-shell";
import { AgentDesk } from "./agent-desk";
import { AgentsBoard, type AgentsBoardStats } from "./agents-board";
import { LoungeRoom } from "./lounge-furniture";
import { TallPlant } from "./office-props";
import type { OfficeLayout } from "./office-layout";
import type { LoungeLayout } from "../life/lounge-layout";
import { AgentActors, useLifeSim, type LifeAgent } from "../life/agent-life";
import { agentIsTyping, agentNeedsDesk } from "../life/policy";
import type { LifeWorldInput } from "../life/world";
import { useCameraStore } from "@/store/camera-store";
import type { AgentSessionView } from "@/server/claude/agent-service";

export interface AgentEntry {
  session: AgentSessionView;
  name: string;
  accent: string;
}

interface AgentsWingProps {
  mainLayout: OfficeLayout;
  agentsLayout: OfficeLayout;
  loungeShellLayout: OfficeLayout;
  lounge: LoungeLayout;
  agentsOffsetX: number;
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

/**
 * Sala dos agentes + lounge. Os personagens são os MESMOS da sala de trabalho (um por sessão de
 * agente): a simulação visual decide se ficam na mesa ou na sala de convivência a partir do
 * estado real — e nunca escreve nada de volta.
 */
export function AgentsWing({ mainLayout, agentsLayout, loungeShellLayout, lounge, agentsOffsetX, entries, stats, selectedAgentId, onSelectAgent, reducedGraphics }: AgentsWingProps) {
  const focusProject = useCameraStore((s) => s.focusProject);
  const focusId = useCameraStore((s) => s.focusId);
  const cameraMode = useCameraStore((s) => s.mode);
  const depth = mainLayout.depth;
  const doorZ = partitionDoorZ(depth);

  const worldInput: LifeWorldInput = useMemo(
    () => ({
      agentsRoom: { minX: agentsOffsetX - agentsLayout.width / 2, maxX: agentsOffsetX + agentsLayout.width / 2 },
      depth,
      lounge,
      desks: agentsLayout.desks.map((d) => ({ id: d.projectId, x: d.x + agentsOffsetX, z: d.z })),
      doorWidth: PARTITION_DOOR_WIDTH,
      extraObstacles: [-1, 1].map((sd) => ({ kind: "circle" as const, cx: agentsOffsetX + sd * (agentsLayout.width / 2 - 1.0), cz: -depth / 2 + 0.9, r: 0.38, label: "plant" })),
    }),
    [agentsOffsetX, agentsLayout, depth, lounge],
  );
  const agents: LifeAgent[] = useMemo(
    () =>
      entries.map((e) => ({
        id: e.session.id,
        accent: e.accent,
        mustWork: agentNeedsDesk(e.session.state),
        working: agentIsTyping(e.session.state),
      })),
    [entries],
  );
  const sim = useLifeSim(worldInput, agents);
  const byId = useMemo(() => new Map(entries.map((e) => [e.session.id, e])), [entries]);
  const f = lounge.furniture;
  const loungeCenterX = lounge.x0 + lounge.width / 2;

  return (
    <>
      {/* sala dos agentes */}
      <group position={[agentsOffsetX, 0, 0]}>
        <OfficeShell layout={agentsLayout} westWall="none" eastDoor />
        <AgentsBoard layout={agentsLayout} stats={stats} />
        {[-1, 1].map((sd) => (
          <group key={sd} position={[sd * (agentsLayout.width / 2 - 1.0), 0, -agentsLayout.depth / 2 + 0.9]}>
            <TallPlant scale={0.95} />
          </group>
        ))}
        {agentsLayout.desks.map((slot) => {
          const entry = byId.get(slot.projectId);
          if (!entry) return null;
          const worldPos: [number, number, number] = [slot.x + agentsOffsetX, 1.0, slot.z];
          return (
            <AgentDesk
              key={slot.projectId}
              slot={slot}
              session={entry.session}
              selected={selectedAgentId === slot.projectId}
              dimmedByFocus={focusId !== null && cameraMode !== "overview" && cameraMode !== "free" && focusId !== slot.projectId}
              reduced={reducedGraphics}
              life={sim}
              onFocus={() => {
                onSelectAgent(slot.projectId);
                focusProject(slot.projectId, worldPos, 2.6, `Agente · ${slot.name}`);
              }}
            />
          );
        })}
      </group>

      {/* os agentes (mesmos personagens) — em qualquer sala, em coordenadas do mundo */}
      <AgentActors sim={sim} agents={agents} reduced={reducedGraphics} />

      {/* lounge */}
      <group position={[loungeCenterX, 0, 0]}>
        <OfficeShell layout={loungeShellLayout} westWall="none" screenPanel={false} />
      </group>
      <LoungeRoom layout={lounge} life={sim} />

      {/* navegação: portas e áreas */}
      <Html position={[mainLayout.width / 2, 3.0, doorZ]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={() => focusProject("agents-room", [agentsOffsetX, 1.0, 0], agentsLayout.radius * 0.5, "Sala dos Agentes")}
          style={pill(stats.approvals > 0)}
        >
          Sala dos Agentes · {stats.approvals > 0 ? `${stats.approvals} aguardando aprovação` : stats.working > 0 ? `${stats.working} trabalhando` : `${stats.active} ativo${stats.active === 1 ? "" : "s"}`}
        </button>
      </Html>
      <Html position={[lounge.x0, 3.0, doorZ]} center zIndexRange={[20, 0]}>
        <button type="button" onClick={() => focusProject("lounge", [loungeCenterX, 1.0, 0], loungeShellLayout.radius * 0.64, "Lounge")} style={pill(false)}>
          Lounge · {stats.idle} descansando
        </button>
      </Html>
      {cameraMode !== "overview" &&
        [
          { id: "lounge-pool", label: "Sinuca", p: [f.pool.x, f.pool.z] as const, r: 3.8 },
          { id: "lounge-bar", label: "Bar", p: [f.bar.x - 1.4, f.bar.z] as const, r: 4.8 },
          { id: "lounge-sofas", label: "Sofás", p: [f.rug.x, f.rug.z] as const, r: 4.0 },
        ].map((h) => (
          <Html key={h.id} position={[h.p[0], 2.5, h.p[1]]} center zIndexRange={[20, 0]}>
            <button type="button" onClick={() => focusProject(h.id, [h.p[0], 1.0, h.p[1]], h.r, h.label)} style={{ ...pill(false), opacity: focusId === h.id ? 0.5 : 0.95 }}>
              {h.label}
            </button>
          </Html>
        ))}
    </>
  );
}
