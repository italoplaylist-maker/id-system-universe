"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { OfficeShell } from "./office/office-shell";
import { OfficeProps } from "./office/office-props";
import { AgentsBoard } from "./office/agents-board";
import { AgentDesk, agentTitle } from "./office/agent-desk";
import { computeOfficeLayout } from "./office/office-layout";
import { UniverseCameraController } from "./camera/universe-camera-controller";
import { useCameraStore } from "@/store/camera-store";
import type { AgentSessionView } from "@/server/claude/agent-service";

const ACCENTS = ["#e8283f", "#38bdf8", "#a78bfa", "#2dd4bf", "#fb923c", "#f0abfc", "#34d399", "#fbbf24"];

interface AgentsSceneProps {
  sessions: AgentSessionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  reducedGraphics: boolean;
}

export function AgentsScene({ sessions, selectedId, onSelect, reducedGraphics }: AgentsSceneProps) {
  const focusProject = useCameraStore((s) => s.focusProject);
  const focusId = useCameraStore((s) => s.focusId);
  const cameraMode = useCameraStore((s) => s.mode);

  // Mesas estáveis: a ordem vem de startedAt, então um agente novo entra no fim sem mover os outros.
  const entries = useMemo(
    () => sessions.map((s, i) => ({ session: s, name: agentTitle(s), accent: ACCENTS[i % ACCENTS.length] })),
    [sessions],
  );
  const layout = useMemo(() => computeOfficeLayout(entries.map((e) => ({ id: e.session.id, name: e.name, accent: e.accent })), []), [entries]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.session.id, e])), [entries]);

  const stats = useMemo(
    () => ({
      active: sessions.length,
      working: sessions.filter((s) => s.state === "WORKING").length,
      idle: sessions.filter((s) => s.state === "IDLE").length,
      errors: sessions.filter((s) => s.state === "ERROR").length,
      tools: sessions.reduce((n, s) => n + s.toolCount, 0),
    }),
    [sessions],
  );
  const [centerX, , centerZ] = layout.center;
  const bg = "#0b1220";

  return (
    <Canvas shadows={!reducedGraphics} dpr={reducedGraphics ? 1 : [1, 1.6]} gl={{ antialias: !reducedGraphics }} className="bg-background">
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, layout.radius * 1.9, layout.radius * 3.6]} />
      <hemisphereLight args={["#a8c4e8", "#1c2740", 1.3] as const} />
      <ambientLight intensity={0.9} />
      <directionalLight
        position={[centerX + 8, Math.max(10, layout.bounds.maxY + 5), centerZ + 12]}
        intensity={1.6}
        color="#dfe9ff"
        castShadow={!reducedGraphics}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-layout.width / 1.6}
        shadow-camera-right={layout.width / 1.6}
        shadow-camera-top={layout.depth}
        shadow-camera-bottom={-layout.depth}
        shadow-camera-far={layout.radius * 6}
      />
      <pointLight position={[-layout.width * 0.25, 3.4, 0]} intensity={1.6} color="#ffe2b8" distance={layout.width * 0.7} decay={1.6} />
      <pointLight position={[layout.width * 0.25, 3.4, 0]} intensity={1.6} color="#ffe2b8" distance={layout.width * 0.7} decay={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.3, centerZ]} receiveShadow>
        <planeGeometry args={[layout.radius * 2.6, layout.radius * 2.8]} />
        <meshStandardMaterial color="#141c28" roughness={1} />
      </mesh>
      {!reducedGraphics && <ContactShadows position={[centerX, 0.003, centerZ]} opacity={0.4} scale={layout.radius * 2.4} blur={2.2} far={4} color="#000000" />}

      <Suspense fallback={null}>
        <OfficeShell layout={layout} />
        <AgentsBoard layout={layout} stats={stats} />
        <OfficeProps layout={layout} />
        {layout.desks.map((slot) => {
          const entry = byId.get(slot.projectId);
          if (!entry) return null;
          return (
            <AgentDesk
              key={slot.projectId}
              slot={slot}
              session={entry.session}
              selected={selectedId === slot.projectId}
              dimmedByFocus={focusId !== null && cameraMode !== "overview" && cameraMode !== "free" && focusId !== slot.projectId}
              reduced={reducedGraphics}
              onFocus={() => {
                onSelect(slot.projectId);
                focusProject(slot.projectId, [slot.x, 1.0, slot.z], 2.6, slot.name);
              }}
            />
          );
        })}
      </Suspense>
      <UniverseCameraController overviewCenter={layout.center} overviewRadius={layout.radius} overviewBounds={layout.bounds} />
    </Canvas>
  );
}

