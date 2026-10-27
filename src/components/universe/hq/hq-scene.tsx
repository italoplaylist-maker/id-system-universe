"use client";

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { computeOfficeLayout } from "./office/office-layout";
import { OfficeShell } from "./office/office-shell";
import { OfficeProps } from "./office/office-props";
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
  reducedGraphics: boolean;
  env: EnvironmentState;
}

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
  const layout = useMemo(() => computeOfficeLayout(activeProjects, enabledProviders), [activeProjects, enabledProviders]);

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

  const { data: sessionUser } = useSession();
  const canSeeBilling = sessionUser ? canUser(sessionUser, "billing:view") : false;
  const { data: billingCounts } = useBillingCounts(canSeeBilling);

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

  const [centerX, , centerZ] = layout.center;

  return (
    <Canvas
      shadows={!reducedGraphics}
      dpr={reducedGraphics ? 1 : [1, 1.6]}
      gl={{ antialias: !reducedGraphics }}
      className="bg-background"
      onPointerMissed={() => selectedProjectId && setSelectedProjectId(null)}
    >
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[bgColor, layout.radius * 1.9, layout.radius * 3.6]} />

      <SkyScene env={env} weatherCondition={weatherCondition} radius={layout.radius} reducedGraphics={reducedGraphics} />
      <ExteriorScene center={layout.center} buildingRadius={layout.radius} nightFactor={nightFactor} reducedGraphics={reducedGraphics} />
      {!reducedGraphics && isRaining && <RainEffect center={layout.center} radius={layout.radius} heavy={weatherCondition === "CHUVA_FORTE"} />}

      <hemisphereLight args={["#a8c4e8", "#1c2740", THREE.MathUtils.lerp(1.0, 1.7, env.daylightFactor)] as const} />
      <ambientLight intensity={THREE.MathUtils.lerp(0.7, 1.1, env.daylightFactor)} />
      <directionalLight
        position={[
          centerX + env.sunDirection[0] * Math.max(layout.radius * 2.2, 18),
          Math.max(8, layout.bounds.maxY + 4, env.sunDirection[1] * Math.max(layout.radius * 2.2, 18)),
          centerZ + env.sunDirection[2] * Math.max(layout.radius * 2.2, 18),
        ]}
        intensity={2.6 * Math.max(sunStrength, 0.08)}
        color={env.sun.altitude < 0.12 ? "#ffb46b" : "#ffffff"}
        castShadow={!reducedGraphics}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-layout.width / 1.6}
        shadow-camera-right={layout.width / 1.6}
        shadow-camera-top={layout.depth}
        shadow-camera-bottom={-layout.depth}
        shadow-camera-far={layout.radius * 6}
      />
      <directionalLight position={[centerX - 8, Math.max(9, layout.bounds.maxY + 4), centerZ + 6]} intensity={0.9} color="#ffd9a8" />
      {/* a few warm interior fills — a handful of lights, never one per desk */}
      <pointLight position={[-layout.width * 0.25, 3.4, 0]} intensity={1.6} color="#ffe2b8" distance={layout.width * 0.7} decay={1.6} />
      <pointLight position={[layout.width * 0.25, 3.4, 0]} intensity={1.6} color="#ffe2b8" distance={layout.width * 0.7} decay={1.6} />
      <pointLight position={[0, 3.2, layout.depth * 0.3]} intensity={1.2} color="#fff0d6" distance={layout.width * 0.7} decay={1.6} />

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
        <planeGeometry args={[layout.radius * 2.6, layout.radius * 2.8]} />
        <meshStandardMaterial color="#141c28" roughness={1} />
      </mesh>
      {!reducedGraphics && <ContactShadows position={[centerX, 0.003, centerZ]} opacity={0.4} scale={layout.radius * 2.4} blur={2.2} far={4} color="#000000" />}

      <Suspense fallback={null}>
        <OfficeShell layout={layout} />
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
      </Suspense>

      <UniverseCameraController overviewCenter={layout.center} overviewRadius={layout.radius} overviewBounds={layout.bounds} />
    </Canvas>
  );
}
