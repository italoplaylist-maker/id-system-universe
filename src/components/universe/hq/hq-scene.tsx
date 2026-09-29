"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { computeHqLayout, computeWorkstationWorldPositions } from "./hq-layout";
import { HqCamera } from "./hq-camera";
import { CorridorScene } from "./corridor-scene";
import { ReceptionScene } from "./reception-scene";
import { ProjectRoomScene } from "./project-room-scene";
import { CommandCenterScene, type CommandCenterStats } from "./command-center-scene";
import { OperationsScene } from "./operations-scene";
import { ServerRoomScene } from "./server-room-scene";
import { TaskAgents } from "./task-agents";
import { PALETTE } from "./palette";
import type { UniverseApplication, UniverseProject, UniverseProviderSummary } from "@/types/domain";

interface HqSceneProps {
  providers: UniverseProviderSummary[];
  projects: UniverseProject[];
  applications: UniverseApplication[];
  selectedApplicationId: string | null;
  onSelectApplication: (id: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenProvider: (providerId: string) => void;
  reducedGraphics: boolean;
  /** Room-level selection (single click) — highlights without moving the camera. */
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  /** Room-level focus (double click) — camera eases toward this project's room, or the overview when null. */
  focusedProjectId: string | null;
  onFocusProject: (projectId: string) => void;
}

const HEALTH_LABEL: Record<UniverseProject["health"], string> = {
  HEALTHY: "Healthy",
  DEPLOYING: "Deploying",
  DEGRADED: "Degraded",
  OFFLINE: "Offline",
  UNKNOWN: "Unknown",
};

export function HqScene({
  providers,
  projects,
  applications,
  selectedApplicationId,
  onSelectApplication,
  onOpenProject,
  onOpenProvider,
  reducedGraphics,
  selectedProjectId,
  onSelectProject,
  focusedProjectId,
  onFocusProject,
}: HqSceneProps) {
  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const activeProjects = useMemo(() => projects.filter((p) => !p.archivedAt), [projects]);

  // Unassigned resources are an administrative state, not a room (briefing
  // 42) — they never get a workstation in the building, only a HUD pill
  // (top-bar.tsx) pointing at /projects.
  const layout = useMemo(() => computeHqLayout(activeProjects, enabledProviders), [activeProjects, enabledProviders]);

  const resourcesByRoom = useMemo(() => {
    const map = new Map<string, UniverseApplication[]>();
    for (const app of applications) {
      if (!app.projectId) continue;
      const list = map.get(app.projectId) ?? [];
      list.push(app);
      map.set(app.projectId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return map;
  }, [applications]);

  const workstationPositions = useMemo(() => computeWorkstationWorldPositions(layout.rooms, resourcesByRoom), [layout.rooms, resourcesByRoom]);

  const projectById = useMemo(() => new Map(activeProjects.map((p) => [p.id, p])), [activeProjects]);

  const focusTarget = useMemo((): [number, number] | null => {
    if (!focusedProjectId) return null;
    const room = layout.rooms.find((r) => r.kind === "project" && r.projectId === focusedProjectId);
    return room ? [room.x, room.z] : null;
  }, [focusedProjectId, layout.rooms]);

  const stats: CommandCenterStats = useMemo(
    () => ({
      projectCount: activeProjects.length,
      resourceCount: applications.length,
      onlineCount: applications.filter((a) => a.status === "RUNNING").length,
      deployingCount: applications.filter((a) => a.status === "DEPLOYING" || a.pendingOperation !== null).length,
      incidentCount: applications.filter((a) => a.status === "ERROR").length,
    }),
    [applications, activeProjects],
  );

  const [centerX, centerZ] = layout.center;

  return (
    <Canvas
      shadows={!reducedGraphics}
      dpr={reducedGraphics ? 1 : [1, 1.6]}
      gl={{ antialias: !reducedGraphics }}
      className="bg-background"
      onPointerMissed={() => selectedProjectId && onSelectProject(null)}
    >
      <color attach="background" args={[PALETTE.background]} />
      <fog attach="fog" args={[PALETTE.background, layout.radius * 1.9, layout.radius * 3.6]} />

      {/* Premium-dark, not blackout: hemisphere gives even fill, one strong key light
          models shadows/contrast, a soft cyan rim keeps the far side of the building readable. */}
      <hemisphereLight args={["#5b6f88", "#0a0d12", 0.85] as const} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[centerX + 9, 14, centerZ + 7]} intensity={1.6} castShadow={!reducedGraphics} shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[centerX - 8, 9, centerZ - 4]} intensity={0.5} color={PALETTE.glass} />
      <pointLight position={[centerX, 5, centerZ]} intensity={0.35} color={PALETTE.screen} distance={layout.radius} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.06, centerZ]} receiveShadow>
        <planeGeometry args={[layout.radius * 2.2, layout.radius * 2.4]} />
        <meshStandardMaterial color="#0c0f14" roughness={1} />
      </mesh>

      {!reducedGraphics && (
        <ContactShadows position={[centerX, 0.001, centerZ]} opacity={0.45} scale={layout.radius * 2.4} blur={2} far={4} color="#000000" />
      )}

      <Suspense fallback={null}>
        <CorridorScene corridor={layout.corridor} />

        {layout.rooms.map((room) => {
          if (room.kind === "reception") return <ReceptionScene key={room.id} room={room} />;
          if (room.kind === "command-center") return <CommandCenterScene key={room.id} room={room} stats={stats} />;
          if (room.kind === "operations") return <OperationsScene key={room.id} room={room} activeCount={stats.deployingCount} />;
          if (room.kind === "server-room") {
            return (
              <ServerRoomScene
                key={room.id}
                room={room}
                racks={layout.serverRacks}
                providers={enabledProviders}
                selectedProviderId={null}
                onSelectProvider={onOpenProvider}
              />
            );
          }
          if (room.kind === "project" && room.projectId) {
            const projectId = room.projectId;
            const project = projectById.get(projectId);
            const resourceCount = resourcesByRoom.get(projectId)?.length ?? room.resourceCount;
            const tooltipLines = [
              `${resourceCount} Resource${resourceCount === 1 ? "" : "s"}`,
              project ? HEALTH_LABEL[project.health] : "Unknown",
            ];
            return (
              <ProjectRoomScene
                key={room.id}
                room={room}
                resources={resourcesByRoom.get(projectId) ?? []}
                selectedResourceId={selectedApplicationId}
                onSelectResource={onSelectApplication}
                onSelectNameplate={() => onOpenProject(projectId)}
                selected={selectedProjectId === projectId || focusedProjectId === projectId}
                tooltipLines={tooltipLines}
                onSelectRoom={() => onSelectProject(projectId)}
                onFocusRoom={() => onFocusProject(projectId)}
              />
            );
          }
          return null;
        })}

        <TaskAgents layout={layout} applications={applications} workstationPositions={workstationPositions} />
      </Suspense>

      <HqCamera radius={layout.radius} centerX={centerX} centerZ={centerZ} focusTarget={focusTarget} />
    </Canvas>
  );
}
