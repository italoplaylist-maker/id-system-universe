"use client";

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { computeOfficeLayout, OFFICE } from "./office/office-layout";
import { OfficeShell, PARTITION_DOOR_WIDTH, partitionDoorZ } from "./office/office-shell";
import { agentTitle } from "./office/agent-desk";
import { AgentsWing } from "./office/agents-wing";
import { LifeLayer } from "./office/life-layer";
import { agentIsTyping, agentNeedsDesk } from "./life/policy";
import type { LifeAgent } from "./life/agent-life";
import type { LifeWorldInput } from "./life/world";
import { computeLoungeLayout, LOUNGE_MIN_DEPTH, LOUNGE_WIDTH } from "./life/lounge-layout";
import { useAgentSessions } from "@/hooks/use-agents";
import { roomAgentToSession, useRoomAgents } from "@/hooks/use-orchestrator";
import { OfficeProps, officePropObstacles } from "./office/office-props";
import { NocWall } from "./office/noc-wall";
import { useServers } from "@/hooks/use-servers";
import { CommandScreen, type CommandCenterStats } from "./office/command-screen";
import { ProjectDesk, deskStateFor } from "./office/project-desk";
import { ProviderRack } from "./provider-rack";
import { UniverseCameraController } from "./camera/universe-camera-controller";
import { useCameraStore } from "@/store/camera-store";
import { SkyScene, skyColor } from "./environment/sky-scene";
import { ExteriorScene } from "./environment/exterior-scene";
import { RainEffect } from "./environment/rain-effect";
import type { EnvironmentState } from "./environment/environment-state";
import { useWeather } from "@/hooks/use-weather";
import { useSession } from "@/hooks/use-session";
import { useBillingCounts } from "@/hooks/use-billing";
import { canUser } from "@/server/auth/rbac";
import type { UniverseApplication, UniverseProject, UniverseProviderSummary } from "@/types/domain";

interface HqSceneProps {
  providers: UniverseProviderSummary[];
  projects: UniverseProject[];
  applications: UniverseApplication[];
  selectedApplicationId: string | null;
  onSelectApplication: (id: string) => void;
  onOpenProvider: (providerId: string) => void;
  onOpenServers: () => void;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  /** Projetos e recursos já chegaram do servidor (ou é demo). Antes disso ninguém é desenhado. */
  dataReady: boolean;
  reducedGraphics: boolean;
  env: EnvironmentState;
}

const AGENT_ACCENTS = ["#e8283f", "#38bdf8", "#a78bfa", "#2dd4bf", "#fb923c", "#f0abfc", "#34d399", "#fbbf24"];

const HEALTH_LABEL: Record<UniverseProject["health"], string> = {
  HEALTHY: "Saudável",
  DEPLOYING: "Implantando",
  DEGRADED: "Degradado",
  OFFLINE: "Offline",
  UNKNOWN: "Desconhecido",
};

const HEALTH_COLOR: Record<UniverseProject["health"], string> = {
  HEALTHY: "#34d399",
  DEPLOYING: "#38bdf8",
  DEGRADED: "#fbbf24",
  OFFLINE: "#f87171",
  UNKNOWN: "#8890a3",
};

export function HqScene({
  providers,
  projects,
  applications,
  selectedApplicationId,
  onSelectApplication,
  onOpenProvider,
  onOpenServers,
  selectedAgentId,
  onSelectAgent,
  dataReady,
  reducedGraphics,
  env,
}: HqSceneProps) {
  const { data: weatherData } = useWeather();
  const weatherCondition = weatherData && "ok" in weatherData && weatherData.ok ? weatherData.condition : null;
  const isRaining = weatherCondition === "CHUVA" || weatherCondition === "CHUVA_FORTE";
  const cloudFactor = weatherCondition === "NUBLADO" || isRaining ? 0.75 : weatherCondition === "PARCIALMENTE_NUBLADO" ? 0.4 : 0;
  // Astronomy decides WHERE the sun is and whether it's day; weather only ever
  // dims/diffuses it — the two are independent, per the spec's own rule.
  const sunStrength = env.daylightFactor * (1 - cloudFactor * 0.55);
  const nightFactor = 1 - env.daylightFactor;
  const bgColor = useMemo(() => skyColor((env.sun.altitude * 180) / Math.PI, cloudFactor * 100), [env.sun.altitude, cloudFactor]);
  // Room highlight is a lightweight visual concern, not a camera one — the
  // camera itself is only ever driven by useCameraStore commands dispatched
  // straight from the room/resource/rack components below.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const focusProject = useCameraStore((s) => s.focusProject);
  const focusResource = useCameraStore((s) => s.focusResource);
  const focusProvider = useCameraStore((s) => s.focusProvider);
  const focusPoint = useCameraStore((s) => s.focusPoint);
  const focusId = useCameraStore((s) => s.focusId);
  const cameraMode = useCameraStore((s) => s.mode);

  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const activeProjects = useMemo(() => projects.filter((p) => !p.archivedAt), [projects]);

  // One big open-plan office: a desk per Project (unassigned resources are an administrative
  // state, not a desk — they only show up as a HUD pill pointing at /projects).
  const { data: sessionUser } = useSession();
  // A sala dos agentes só existe para quem pode ler infraestrutura (a API exige escopo global).
  const canReadAgents = sessionUser ? canUser(sessionUser, "provider:read") : false;
  const { data: observedSessions } = useAgentSessions(canReadAgents);
  const { data: roomAgents } = useRoomAgents(canReadAgents);
  // Funcionários permanentes (perfis) primeiro, em ordem estável; depois as sessões externas observadas pelo hook.
  // Os perfis existem independentemente de haver tarefa: terminar, atualizar a página ou sincronizar não os remove.
  const agentSessions = useMemo(
    () => (observedSessions === undefined && roomAgents === undefined ? undefined : [...(roomAgents ?? []).map(roomAgentToSession), ...(observedSessions ?? [])]),
    [observedSessions, roomAgents],
  );
  const agentsEnabled = agentSessions !== undefined;

  const agentEntries = useMemo(
    () => {
      const list = agentSessions ?? [];
      const titles = list.map((s) => agentTitle(s));
      // Vários agentes no mesmo repositório: um sufixo curto os distingue na placa da mesa.
      return list.map((s, i) => ({
        session: s,
        name: titles.filter((t) => t === titles[i]).length > 1 ? `${titles[i]} #${s.id.slice(-3)}` : titles[i],
        accent: AGENT_ACCENTS[i % AGENT_ACCENTS.length],
      }));
    },
    [agentSessions],
  );
  const agentLayoutKey = agentEntries.map((e) => `${e.session.id}:${e.name}:${e.accent}`).join("|");
  // Três salas lado a lado (operações · agentes · lounge) com a mesma profundidade: fundos alinhados.
  const { layout, agentsLayout, loungeLayout, loungeShellLayout } = useMemo(() => {
    const agentInputs = agentEntries.map((e) => ({ id: e.session.id, name: e.name, accent: e.accent }));
    const mainNatural = computeOfficeLayout(activeProjects, enabledProviders).depth;
    const agentsNatural = agentsEnabled ? computeOfficeLayout(agentInputs, [], { minWidth: 10 }).depth : 0;
    const minDepth = Math.max(mainNatural, agentsNatural, agentsEnabled ? LOUNGE_MIN_DEPTH : 0);
    const main = computeOfficeLayout(activeProjects, enabledProviders, { minDepth });
    const agents = agentsEnabled ? computeOfficeLayout(agentInputs, [], { minWidth: 10, minDepth }) : null;
    const lounge = agents ? computeLoungeLayout(main.width / 2 + agents.width, main.depth, partitionDoorZ(main.depth)) : null;
    const loungeShell = lounge ? computeOfficeLayout([], [], { minWidth: LOUNGE_WIDTH, minDepth: main.depth }) : null;
    return { layout: main, agentsLayout: agents, loungeLayout: lounge, loungeShellLayout: loungeShell };
    // As salas só dependem de QUEM são os agentes (ids/nomes), não do que eles estão fazendo agora:
    // o estado muda a cada poucos segundos e não pode reconstruir layout nem malha de navegação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjects, enabledProviders, agentLayoutKey, agentsEnabled]);
  const agentsOffsetX = agentsLayout ? layout.width / 2 + agentsLayout.width / 2 : 0;

  // O "mundo" que a câmera, o céu, a sombra e a luz enxergam: as três salas juntas.
  const world = useMemo(() => {
    if (!agentsLayout || !loungeLayout) return { width: layout.width, depth: layout.depth, center: layout.center, radius: layout.radius, bounds: layout.bounds };
    const extra = agentsLayout.width + loungeLayout.width;
    const bounds = { ...layout.bounds, maxX: layout.bounds.maxX + extra };
    const width = layout.width + extra;
    const center: [number, number, number] = [extra / 2, layout.center[1], layout.center[2]];
    const radius = Math.sqrt((width / 2) ** 2 + (layout.depth / 2) ** 2 + (OFFICE.WALL_HEIGHT / 2) ** 2) + 2;
    return { width, depth: layout.depth, center, radius, bounds };
  }, [layout, agentsLayout, loungeLayout]);
  const agentStats = useMemo(() => {
    const list = agentSessions ?? [];
    return {
      active: list.length,
      working: list.filter((s) => s.state === "WORKING").length,
      idle: list.filter((s) => s.state === "IDLE").length,
      errors: list.filter((s) => s.state === "ERROR").length,
      approvals: list.filter((s) => s.state === "APPROVAL").length,
      tools: list.reduce((n, s) => n + s.toolCount, 0),
    };
  }, [agentSessions]);

  const resourcesByProject = useMemo(() => {
    const map = new Map<string, UniverseApplication[]>();
    for (const app of applications) {
      if (!app.projectId) continue;
      const list = map.get(app.projectId) ?? [];
      list.push(app);
      map.set(app.projectId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
    return map;
  }, [applications]);

  const projectById = useMemo(() => new Map(activeProjects.map((p) => [p.id, p])), [activeProjects]);
  const deskStates = useMemo(() => new Map(layout.desks.map((d) => [d.projectId, deskStateFor(resourcesByProject.get(d.projectId) ?? [])])), [layout.desks, resourcesByProject]);

  // ---- vida dos personagens (só visual; lê o estado real, nunca escreve) -------------------------------
  // Geometria: salas lado a lado, mesas (largura do tampo varia com os monitores) e móveis que bloqueiam o caminho.
  const lifeWorld: LifeWorldInput | null = useMemo(() => {
    if (!agentsLayout || !loungeLayout) return null;
    const deskHalfW = (id: string) => {
      const monitors = Math.min(3, Math.max(1, (resourcesByProject.get(id) ?? []).length));
      return (monitors === 1 ? 1.5 : monitors === 2 ? 1.75 : 2.1) / 2 + 0.05;
    };
    return {
      rooms: [
        { minX: -layout.width / 2, maxX: layout.width / 2 },
        { minX: layout.width / 2, maxX: layout.width / 2 + agentsLayout.width },
        { minX: loungeLayout.x0, maxX: loungeLayout.x0 + loungeLayout.width },
      ],
      doorZ: partitionDoorZ(layout.depth),
      depth: layout.depth,
      lounge: loungeLayout,
      doorWidth: PARTITION_DOOR_WIDTH,
      desks: [
        ...layout.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z, halfW: deskHalfW(d.projectId) })),
        ...agentsLayout.desks.map((d) => ({ id: d.projectId, x: d.x + agentsOffsetX, z: d.z })),
      ],
      extraObstacles: [
        ...officePropObstacles(layout),
        ...[-1, 1].map((sd) => ({ kind: "circle" as const, cx: agentsOffsetX + sd * (agentsLayout.width / 2 - 1.0), cz: -layout.depth / 2 + 0.9, r: 0.38, label: "plant" })),
      ],
    };
  }, [layout, agentsLayout, loungeLayout, agentsOffsetX, resourcesByProject]);
  const lifeAgents: LifeAgent[] = useMemo(
    () => [
      // Funcionários dos projetos: trabalhando (deploy/operação) ou com erro ficam na mesa; sem trabalho circulam; tudo parado = ausente.
      ...layout.desks.flatMap((slot) => {
        const state = deskStates.get(slot.projectId) ?? "IDLE";
        if (state === "OFF") return [];
        return [{ id: slot.projectId, accent: slot.accent, mustWork: state === "WORKING" || state === "ERROR", working: state === "WORKING" }];
      }),
      // Agentes do Claude: pelo estado real da sessão.
      ...agentEntries.map((e) => ({ id: e.session.id, accent: e.accent, mustWork: e.session.profile ? true : agentNeedsDesk(e.session.state), working: e.session.profile ? e.session.profile.roomState === "RUNNING" : agentIsTyping(e.session.state) })),
    ],
    [layout.desks, deskStates, agentEntries],
  );
  const restingCount = lifeAgents.filter((a) => !a.mustWork).length;

  const canSeeBilling = sessionUser ? canUser(sessionUser, "billing:view") : false;
  const { data: billingCounts } = useBillingCounts(canSeeBilling);
  // A parede do NOC só existe para quem pode ler servidores (a API exige escopo global).
  const { data: monitoredServers } = useServers(sessionUser ? canUser(sessionUser, "provider:read") : false);
  const nocEnabled = monitoredServers !== undefined;

  const stats: CommandCenterStats = useMemo(
    () => ({
      projectCount: activeProjects.length,
      resourceCount: applications.length,
      onlineCount: applications.filter((a) => a.status === "RUNNING").length,
      deployingCount: applications.filter((a) => a.status === "DEPLOYING" || a.pendingOperation !== null).length,
      incidentCount: applications.filter((a) => a.status === "ERROR").length,
      // Real headcount: one employee per project desk, and none at a desk that's shut down.
      employeeCount: layout.desks.filter((d) => deskStates.get(d.projectId) !== "OFF").length,
      billing: canSeeBilling ? (billingCounts ?? null) : null,
    }),
    [applications, activeProjects, layout.desks, deskStates, canSeeBilling, billingCounts],
  );

  // Com agentes + lounge, os personagens são movidos pela simulação; sem isso, as mesas funcionam como antes.
  const withLife = (children: React.ReactNode) =>
    lifeWorld ? (
      <LifeLayer world={lifeWorld} agents={lifeAgents} reduced={reducedGraphics} ready={dataReady}>
        {children}
      </LifeLayer>
    ) : (
      children
    );

  const [centerX, , centerZ] = world.center;

  return (
    <Canvas
      shadows={!reducedGraphics}
      dpr={reducedGraphics ? 1 : [1, 1.6]}
      gl={{ antialias: !reducedGraphics }}
      className="bg-background"
      onCreated={({ gl, scene }) => {
        // Só em builds de diagnóstico (NEXT_PUBLIC_DEBUG_SCENE=1): expõe o renderer para medir draw calls/memória.
        if (process.env.NEXT_PUBLIC_DEBUG_SCENE) (window as unknown as { __isuScene?: unknown }).__isuScene = { gl, scene };
      }}
      onPointerMissed={() => selectedProjectId && setSelectedProjectId(null)}
    >
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[bgColor, world.radius * 1.9, world.radius * 3.6]} />

      <SkyScene env={env} weatherCondition={weatherCondition} radius={world.radius} reducedGraphics={reducedGraphics} />
      <ExteriorScene center={world.center} buildingRadius={world.radius} nightFactor={nightFactor} reducedGraphics={reducedGraphics} />
      {!reducedGraphics && isRaining && <RainEffect center={world.center} radius={world.radius} heavy={weatherCondition === "CHUVA_FORTE"} />}

      <hemisphereLight args={["#a8c4e8", "#1c2740", THREE.MathUtils.lerp(1.0, 1.7, env.daylightFactor)] as const} />
      <ambientLight intensity={THREE.MathUtils.lerp(0.7, 1.1, env.daylightFactor)} />
      <directionalLight
        position={[
          centerX + env.sunDirection[0] * Math.max(world.radius * 2.2, 18),
          Math.max(8, world.bounds.maxY + 4, env.sunDirection[1] * Math.max(world.radius * 2.2, 18)),
          centerZ + env.sunDirection[2] * Math.max(world.radius * 2.2, 18),
        ]}
        intensity={2.6 * Math.max(sunStrength, 0.08)}
        color={env.sun.altitude < 0.12 ? "#ffb46b" : "#ffffff"}
        castShadow={!reducedGraphics}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-world.width / 1.6}
        shadow-camera-right={world.width / 1.6}
        shadow-camera-top={world.depth}
        shadow-camera-bottom={-world.depth}
        shadow-camera-far={world.radius * 6}
      />
      <directionalLight position={[centerX - 8, Math.max(9, world.bounds.maxY + 4), centerZ + 6]} intensity={0.9} color="#ffd9a8" />
      {/* a few warm interior fills — a handful of lights, never one per desk */}
      <pointLight position={[-layout.width * 0.25, 3.4, 0]} intensity={1.6} color="#ffe2b8" distance={layout.width * 0.7} decay={1.6} />
      <pointLight position={[layout.width * 0.25, 3.4, 0]} intensity={1.6} color="#ffe2b8" distance={layout.width * 0.7} decay={1.6} />
      <pointLight position={[0, 3.2, layout.depth * 0.3]} intensity={1.2} color="#fff0d6" distance={layout.width * 0.7} decay={1.6} />
      {agentsLayout && <pointLight position={[agentsOffsetX, 3.4, 0]} intensity={1.6} color="#dfe9ff" distance={agentsLayout.width * 1.2} decay={1.6} />}

      {/* Double-click empty floor = "look here" (Focus modes only; Overview is a locked maquette). */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centerX, -0.3, centerZ]}
        receiveShadow
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (cameraMode === "overview") return;
          focusPoint([e.point.x, 0.6, e.point.z]);
        }}
      >
        <planeGeometry args={[world.radius * 2.6, world.radius * 2.8]} />
        <meshStandardMaterial color="#141c28" roughness={1} />
      </mesh>
      {!reducedGraphics && <ContactShadows position={[centerX, 0.003, centerZ]} opacity={0.4} scale={world.radius * 2.4} blur={2.2} far={4} color="#000000" />}

      <Suspense fallback={null}>
        {withLife(
          <>
        <OfficeShell layout={layout} nocEnabled={nocEnabled} eastDoor={agentsLayout !== null} />
        {nocEnabled && <NocWall layout={layout} servers={monitoredServers} onOpen={onOpenServers} />}
        <CommandScreen layout={layout} stats={stats} />
        <OfficeProps layout={layout} />

        {layout.racks.map((rack) => {
          const provider = enabledProviders.find((p) => p.id === rack.providerId);
          if (!provider) return null;
          return (
            <ProviderRack
              key={rack.providerId}
              provider={provider}
              position={[rack.x, rack.z]}
              selected={rack.providerId === focusId}
              onSelect={onOpenProvider}
              onFocus={() => focusProvider(rack.providerId, [rack.x, 1, rack.z], 2.5, provider.name)}
            />
          );
        })}

        {layout.desks.map((slot) => {
          const project = projectById.get(slot.projectId);
          const resources = resourcesByProject.get(slot.projectId) ?? [];
          const state = deskStates.get(slot.projectId) ?? "IDLE";
          return (
            <ProjectDesk
              key={slot.projectId}
              slot={slot}
              resources={resources}
              state={state}
              statusLabel={project ? HEALTH_LABEL[project.health] : "Desconhecido"}
              statusColor={project ? HEALTH_COLOR[project.health] : HEALTH_COLOR.UNKNOWN}
              selected={focusId === slot.projectId || selectedProjectId === slot.projectId || resources.some((r) => r.id === selectedApplicationId)}
              dimmedByFocus={focusId !== null && cameraMode !== "overview" && cameraMode !== "free" && focusId !== slot.projectId && !resources.some((r) => r.id === focusId)}
              reduced={reducedGraphics}
              onFocusProject={() => {
                setSelectedProjectId(slot.projectId);
                focusProject(slot.projectId, [slot.x, 1.0, slot.z], 2.6, slot.name);
              }}
              onSelectResource={onSelectApplication}
              onFocusResource={(resourceId, worldPos, name) =>
                focusResource(resourceId, worldPos, name, { id: slot.projectId, center: [slot.x, 1.0, slot.z], radius: 2.6, label: slot.name })
              }
            />
          );
        })}

        {agentsLayout && loungeLayout && loungeShellLayout && (
          <AgentsWing
            mainLayout={layout}
            agentsLayout={agentsLayout}
            loungeShellLayout={loungeShellLayout}
            lounge={loungeLayout}
            agentsOffsetX={agentsOffsetX}
            entries={agentEntries}
            stats={agentStats}
            resting={restingCount}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
            reducedGraphics={reducedGraphics}
          />
        )}
          </>,
        )}
      </Suspense>

      <UniverseCameraController overviewCenter={world.center} overviewRadius={world.radius} overviewBounds={world.bounds} />
    </Canvas>
  );
}
