"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { QUALITY_PROFILES, type GraphicsQuality } from "./render/quality";
import { StudioEnvironment } from "./render/studio-environment";
import * as THREE from "three";
import { computeAgentPods, computeOfficeLayout } from "./office/office-layout";
import { computeHqPlan } from "./plan/hq-plan";
import { Atrium, Ramp } from "./office/atrium";
import { ATRIUM_WANDER, atriumObstacles } from "./plan/atrium-layout";
import { CLT_ROOM, computeCltLayout, CLT_MAX_STATIONS, COMMERCIAL_MAX_STATIONS } from "./plan/clt-layout";
import { toWorld } from "./life/geometry";
import { useHqViews } from "@/store/hq-views-store";
import { OfficeShell, partitionDoorZ } from "./office/office-shell";
import { agentTitle } from "./office/agent-desk";
import { AgentsWing } from "./office/agents-wing";
import { CltWing } from "./office/clt-wing";
import { LifeLayer } from "./office/life-layer";
import { agentIsTyping, agentNeedsDesk } from "./life/policy";
import type { LifeAgent } from "./life/agent-life";
import type { PlanWorldInput } from "./life/world";
import { useAgentSessions } from "@/hooks/use-agents";
import { agentAccent, orderAgentSessions } from "@/lib/agent-order";
import { roomAgentToSession, useClaudeUsage, useCommercial, useCommercialMutations, useOrchestratorMutations, useRoomAgents } from "@/hooks/use-orchestrator";
import { toast } from "sonner";
import { OfficeProps, officePropObstacles } from "./office/office-props";
import { NocWall } from "./office/noc-wall";
import { ServerRoom } from "./office/server-room";
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
  /** Clique na tela de comando: abre o log de atividade/incidentes. */
  onOpenActivity?: () => void;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  /** Abre o painel da equipe COMERCIAL & MARKETING (clique no núcleo da segunda ilha). */
  onOpenCommercial: () => void;
  /** Projetos e recursos já chegaram do servidor (ou é demo). Antes disso ninguém é desenhado. */
  dataReady: boolean;
  reducedGraphics: boolean;
  /** Nível de qualidade (alto/médio/baixo). `reducedGraphics` é o mesmo que "low". */
  quality?: GraphicsQuality;
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
  onOpenActivity,
  selectedAgentId,
  onSelectAgent,
  onOpenCommercial,
  dataReady,
  reducedGraphics: reducedGraphicsProp,
  quality: qualityProp,
  env,
}: HqSceneProps) {
  const quality: GraphicsQuality = qualityProp ?? (reducedGraphicsProp ? "low" : "high");
  const profile = QUALITY_PROFILES[quality];
  const reducedGraphics = quality === "low";
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
  const { createCltTeam } = useOrchestratorMutations();
  const commercialQuery = useCommercial(canReadAgents);
  const commercialMut = useCommercialMutations();
  const canManageTeam = sessionUser ? canUser(sessionUser, "provider:write") : false;
  // Funcionários permanentes (perfis) primeiro, em ordem estável; depois as sessões externas observadas pelo hook.
  // Os perfis existem independentemente de haver tarefa: terminar, atualizar a página ou sincronizar não os remove.
  const agentSessions = useMemo(
    () => (observedSessions === undefined && roomAgents === undefined ? undefined : orderAgentSessions((roomAgents ?? []).filter((a) => a.team !== "CLT" && a.team !== "COMERCIAL").map(roomAgentToSession), observedSessions ?? [])),
    [observedSessions, roomAgents],
  );
  const agentsEnabled = agentSessions !== undefined;
  // Equipe AGENTES CLT (sala própria): agentes reais do orquestrador, na ordem de cadastro (o ID Manager é o primeiro).
  const cltEntries = useMemo(
    () =>
      (roomAgents ?? [])
        .filter((a) => a.team === "CLT")
        .slice(0, CLT_MAX_STATIONS)
        .map(roomAgentToSession)
        .map((session) => ({ session, name: session.profile?.title ?? "Agente", accent: agentAccent(session.id, AGENT_ACCENTS) })),
    [roomAgents],
  );

  // Segunda ilha da mesma sala: equipe COMERCIAL & MARKETING, também de agentes reais do orquestrador.
  const commercialEntries = useMemo(
    () =>
      (roomAgents ?? [])
        .filter((a) => a.team === "COMERCIAL")
        .slice(0, COMMERCIAL_MAX_STATIONS)
        .map(roomAgentToSession)
        .map((session) => ({ session, name: session.profile?.title ?? "Agente", accent: "#f59e0b" })),
    [roomAgents],
  );

  const agentEntries = useMemo(
    () => {
      const list = agentSessions ?? [];
      const titles = list.map((s) => agentTitle(s));
      // Vários agentes no mesmo repositório: um sufixo curto os distingue na placa da mesa.
      return list.map((s, i) => ({
        session: s,
        name: titles.filter((t) => t === titles[i]).length > 1 ? `${titles[i]} #${s.id.slice(-3)}` : titles[i],
        accent: agentAccent(s.id, AGENT_ACCENTS),
      }));
    },
    [agentSessions],
  );
  const agentLayoutKey = agentEntries.map((e) => `${e.session.id}:${e.name}:${e.accent}`).join("|");
  // Planta em Y: três alas (tecnológica, operacional, AGENTES CLT) ligadas por um átrio central. Cada ala é uma sala com o
  // seu próprio sistema de coordenadas; `plan` as posiciona, gira e põe em níveis diferentes.
  const cltCount = cltEntries.length;
  const commercialCount = commercialEntries.length;
  const { layout, agentsLayout, cltLayout, cltShellLayout, plan } = useMemo(() => {
    const agentInputs = agentEntries.map((e) => ({ id: e.session.id, name: e.name, accent: e.accent }));
    const main = computeOfficeLayout(activeProjects, enabledProviders);
    const agents = computeAgentPods(agentInputs);
    const cltRoom = computeCltLayout(cltCount, commercialCount);
    const cltShell = computeOfficeLayout([], [], { minWidth: CLT_ROOM.width, minDepth: CLT_ROOM.depth });
    const hq = computeHqPlan({
      tech: { width: main.width, depth: main.depth, doorZ: partitionDoorZ(main.depth) },
      agents: { width: agents.width, depth: agents.depth, doorZ: agents.aisleZ },
      clt: { width: CLT_ROOM.width, depth: CLT_ROOM.depth, doorZ: cltRoom.doorZ },
    });
    return { layout: main, agentsLayout: agents, cltLayout: cltRoom, cltShellLayout: cltShell, plan: hq };
    // As alas só dependem de QUEM são os agentes (ids/nomes), não do que eles estão fazendo agora:
    // o estado muda a cada poucos segundos e não pode reconstruir layout nem malha de navegação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjects, enabledProviders, agentLayoutKey, cltCount, commercialCount]);

  // O "mundo" que a câmera, o céu, a sombra e a luz enxergam: a planta inteira.
  const world = useMemo(() => ({ width: plan.bounds.maxX - plan.bounds.minX, depth: plan.bounds.maxZ - plan.bounds.minZ, center: plan.center, radius: plan.radius, bounds: plan.bounds }), [plan]);
  const tech = plan.wings.tech;
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
  const lifeWorld: PlanWorldInput | null = useMemo(() => {
    if (!agentsEnabled) return null;
    const deskHalfW = (id: string) => {
      const monitors = Math.min(3, Math.max(1, (resourcesByProject.get(id) ?? []).length));
      return (monitors === 1 ? 1.5 : monitors === 2 ? 1.75 : 2.1) / 2 + 0.05;
    };
    return {
      plan,
      techDesks: layout.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z, halfW: deskHalfW(d.projectId) })),
      techObstacles: officePropObstacles(layout),
      agentDesks: agentsLayout.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z, yaw: d.yaw ?? 0 })),
      agentObstacles: [
        ...[-1, 1].map((sd) => ({ kind: "circle" as const, cx: sd * (agentsLayout.width / 2 - 0.9), cz: -agentsLayout.depth / 2 + 0.9, r: 0.38, label: "plant" })),
        ...agentsLayout.rooms.map((r) => ({ kind: "rect" as const, minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2, label: "project-room" })),
      ],
      cltDesks: [
        ...cltLayout.stations.map((st, i) => ({ id: cltEntries[i]?.session.id ?? `clt-vaga-${i}`, x: st.x, z: st.z, yaw: st.yaw })),
        ...cltLayout.commercial.stations.map((st, i) => ({ id: commercialEntries[i]?.session.id ?? `clt-vaga-c${i}`, x: st.x, z: st.z, yaw: st.yaw })),
      ].filter((d) => !d.id.startsWith("clt-vaga-")),
      cltObstacles: cltLayout.obstacles,
      wander: ATRIUM_WANDER,
      atriumObstacles: atriumObstacles(),
    };
  }, [plan, layout, agentsLayout, cltLayout, cltEntries, commercialEntries, resourcesByProject, agentsEnabled]);
  const lifeAgents: LifeAgent[] = useMemo(
    () => [
      // Funcionários dos projetos: trabalhando (deploy/operação) ou com erro ficam na mesa; sem trabalho circulam; tudo parado = ausente.
      ...layout.desks.flatMap((slot) => {
        const state = deskStates.get(slot.projectId) ?? "IDLE";
        if (state === "OFF") return [];
        return [{ id: slot.projectId, accent: slot.accent, mustWork: state === "WORKING" || state === "ERROR", working: state === "WORKING" }];
      }),
      // Agentes do Claude: pelo estado real da sessão.
      ...[...agentEntries, ...cltEntries, ...commercialEntries].map((e) => ({ id: e.session.id, accent: e.accent, mustWork: agentNeedsDesk(e.session.state), working: e.session.profile ? e.session.profile.roomState === "RUNNING" : agentIsTyping(e.session.state) })),
    ],
    [layout.desks, deskStates, agentEntries, cltEntries, commercialEntries],
  );

  const canSeeBilling = sessionUser ? canUser(sessionUser, "billing:view") : false;
  const { data: billingCounts } = useBillingCounts(canSeeBilling);
  // A parede do NOC só existe para quem pode ler servidores (a API exige escopo global).
  const { data: monitoredServers } = useServers(sessionUser ? canUser(sessionUser, "provider:read") : false);
  const nocEnabled = monitoredServers !== undefined;
  // Uso do plano do Claude no núcleo: só para quem pode ler a central (provider:read); em erro de acesso o bloco some.
  const canSeeClaude = sessionUser ? canUser(sessionUser, "provider:read") : false;
  const { data: claudeUsage, isError: claudeError } = useClaudeUsage(canSeeClaude);

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
      claude: canSeeClaude && !claudeError ? (claudeUsage ?? null) : undefined,
    }),
    [applications, activeProjects, layout.desks, deskStates, canSeeBilling, billingCounts, canSeeClaude, claudeError, claudeUsage],
  );

  // Com agentes, os personagens são movidos pela simulação; sem isso, as mesas funcionam como antes.
  const withLife = (children: React.ReactNode) =>
    lifeWorld ? (
      <LifeLayer world={lifeWorld} agents={lifeAgents} reduced={reducedGraphics} ready={dataReady}>
        {children}
      </LifeLayer>
    ) : (
      children
    );

  const setViews = useHqViews((st) => st.setViews);
  useEffect(() => {
    const ag = plan.wings.agents;
    const clt = plan.wings.clt;
    const t = plan.wings.tech;
    const cltIsland = toWorld(clt, { x: cltLayout.table.x, z: cltLayout.table.z });
    const comIsland = toWorld(clt, { x: cltLayout.commercial.core.x, z: cltLayout.commercial.core.z });
    setViews([
      { id: "core", label: "Núcleo", center: [0, plan.atrium.level + 1.2, 0], radius: 5.5 },
      { id: "ops", label: "Operacional", center: [ag.x, ag.level + 1.0, ag.z], radius: Math.max(ag.width, ag.depth) * 0.5 },
      // As duas ilhas dividem a sala: a câmera enquadra cada uma (CLT a leste/porta, Comercial a oeste).
      { id: "clt", label: "AGENTES CLT", center: [cltIsland.x, clt.level + 1.0, cltIsland.z], radius: 9.5 },
      { id: "comercial", label: "COMERCIAL & MARKETING", center: [comIsland.x, clt.level + 1.0, comIsland.z], radius: 9.5 },
      { id: "tech", label: "Tecnológica", center: [t.x, t.level + 1.0, t.z], radius: Math.max(t.width, t.depth) * 0.5 },
    ]);
  }, [plan, cltLayout, setViews]);

  const [centerX, , centerZ] = world.center;

  return (
    <Canvas
      shadows={profile.shadows ? "soft" : false}
      dpr={profile.dpr}
      gl={{ antialias: profile.antialias, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: THREE.MathUtils.lerp(0.9, 0.88, env.daylightFactor), powerPreference: "high-performance" }}
      className="bg-background"
      onCreated={({ gl, scene }) => {
        // Só em builds de diagnóstico (NEXT_PUBLIC_DEBUG_SCENE=1): expõe o renderer para medir draw calls/memória.
        if (process.env.NEXT_PUBLIC_DEBUG_SCENE) (window as unknown as { __isuScene?: unknown }).__isuScene = { gl, scene };
      }}
      onPointerMissed={() => selectedProjectId && setSelectedProjectId(null)}
    >
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[bgColor, world.radius * 1.9, world.radius * 3.6]} />

      {profile.environment && <StudioEnvironment daylight={env.daylightFactor} profile={profile} />}
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
        castShadow={profile.shadows}
        shadow-mapSize={[profile.shadowMapSize, profile.shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-world.radius * 1.05}
        shadow-camera-right={world.radius * 1.05}
        shadow-camera-top={world.radius * 1.05}
        shadow-camera-bottom={-world.radius * 1.05}
        shadow-camera-far={world.radius * 6}
      />
      <directionalLight position={[centerX - 8, Math.max(9, world.bounds.maxY + 4), centerZ + 6]} intensity={0.9} color="#ffd9a8" />
      {/* poucas luzes quentes de preenchimento — uma por ala, nunca uma por mesa */}
      {quality === "high" && Object.values(plan.wings).map((w) => {
        const reach = Math.max(w.width, w.depth) * 0.75;
        return <pointLight key={w.id} position={[w.x, w.level + 3.4, w.z]} intensity={1.7} color={w.id === "tech" ? "#dfe9ff" : "#ffe2b8"} distance={reach} decay={1.6} />;
      })}

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
      {profile.contactShadows && <ContactShadows position={[centerX, 0.003, centerZ]} opacity={0.4} scale={world.radius * 2.4} blur={2.2} far={4} color="#000000" />}

      <Suspense fallback={null}>
        {withLife(
          <>
            {/* Átrio central + núcleo de comando; rampas ligam cada ala ao átrio */}
            <Atrium plan={plan} stats={stats} onOpenActivity={onOpenActivity} reduced={reducedGraphics} />
            {plan.ramps
              .filter((r) => r.wing === "tech" || agentsEnabled)
              .map((r) => (
                <Ramp key={r.wing} ramp={r} />
              ))}

            {/* Ala Tecnológica — projetos, aplicações, racks e NOC; girada e em +0,20 m */}
            <group position={[tech.x, tech.level, tech.z]} rotation={[0, tech.rot, 0]}>
              <OfficeShell layout={layout} nocEnabled={nocEnabled} doorSide="east" doorZ={partitionDoorZ(layout.depth)} wallHeight={tech.wallHeight} tint="#3b414d" tower={{ side: -1, extra: 1.6 }} />
              {nocEnabled && <NocWall layout={layout} servers={monitoredServers} onOpen={onOpenServers} />}
              <CommandScreen layout={layout} stats={stats} onOpen={onOpenActivity} />
              <OfficeProps layout={layout} />
              <ServerRoom layout={layout} />
              {layout.racks.map((rack) => {
                const provider = enabledProviders.find((p) => p.id === rack.providerId);
                if (!provider) return null;
                const wp = toWorld(tech, { x: rack.x, z: rack.z });
                return (
                  <ProviderRack
                    key={rack.providerId}
                    provider={provider}
                    position={[rack.x, rack.z]}
                    selected={rack.providerId === focusId}
                    onSelect={onOpenProvider}
                    onFocus={() => focusProvider(rack.providerId, [wp.x, 1 + tech.level, wp.z], 2.5, provider.name)}
                  />
                );
              })}
            </group>

            {layout.desks.map((slot) => {
              const project = projectById.get(slot.projectId);
              const resources = resourcesByProject.get(slot.projectId) ?? [];
              const state = deskStates.get(slot.projectId) ?? "IDLE";
              const wp = toWorld(tech, { x: slot.x, z: slot.z });
              const worldSlot = { ...slot, x: wp.x, z: wp.z };
              return (
                <ProjectDesk
                  key={slot.projectId}
                  slot={worldSlot}
                  yaw={tech.rot}
                  level={tech.level}
                  resources={resources}
                  state={state}
                  statusLabel={project ? HEALTH_LABEL[project.health] : "Desconhecido"}
                  statusColor={project ? HEALTH_COLOR[project.health] : HEALTH_COLOR.UNKNOWN}
                  selected={focusId === slot.projectId || selectedProjectId === slot.projectId || resources.some((r) => r.id === selectedApplicationId)}
                  dimmedByFocus={focusId !== null && cameraMode !== "overview" && cameraMode !== "free" && focusId !== slot.projectId && !resources.some((r) => r.id === focusId)}
                  reduced={reducedGraphics}
                  onFocusProject={() => {
                    setSelectedProjectId(slot.projectId);
                    focusProject(slot.projectId, [wp.x, 1.0 + tech.level, wp.z], 2.6, slot.name);
                  }}
                  onSelectResource={onSelectApplication}
                  onFocusResource={(resourceId, worldPos, name) =>
                    focusResource(resourceId, worldPos, name, { id: slot.projectId, center: [wp.x, 1.0 + tech.level, wp.z], radius: 2.6, label: slot.name })
                  }
                />
              );
            })}

            {agentsEnabled && (
              <CltWing
                plan={plan}
                shellLayout={cltShellLayout}
                layout={cltLayout}
                entries={cltEntries}
                commercial={{
                  entries: commercialEntries,
                  indicators: commercialQuery.data?.indicators ?? null,
                  exists: commercialEntries.length > 0,
                  onOpen: () => {
                    if (commercialEntries.length === 0) {
                      if (canManageTeam && !commercialMut.createTeam.isPending) commercialMut.createTeam.mutate(undefined, { onSuccess: (r) => toast.success(r.created.length ? `Equipe Comercial criada: ${r.created.length} funcionário(s).` : "A equipe Comercial já existia."), onError: (e) => toast.error(e.message) });
                      return;
                    }
                    onOpenCommercial();
                  },
                }}
                selectedAgentId={selectedAgentId}
                onSelectAgent={onSelectAgent}
                reducedGraphics={reducedGraphics}
                onCreateTeam={
                  canManageTeam && !createCltTeam.isPending
                    ? () =>
                        createCltTeam.mutate(undefined, {
                          onSuccess: (r) => toast.success(r.created.length ? `Equipe CLT criada: ${r.created.length} funcionário(s).` : "A equipe CLT já existia."),
                          onError: (e) => toast.error(e.message),
                        })
                    : undefined
                }
              />
            )}

            {agentsEnabled && (
              <AgentsWing
                plan={plan}
                agentsLayout={agentsLayout}
                entries={agentEntries}
                stats={agentStats}
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
