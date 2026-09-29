"use client";

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { computeHqLayout, computeWorkstationWorldPositions } from "./hq-layout";
import { UniverseCameraController } from "./camera/universe-camera-controller";
import { useCameraStore } from "@/store/camera-store";
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
}: HqSceneProps) {
  // Room highlight is a lightweight visual concern, not a camera one — the
  // camera itself is only ever driven by useCameraStore commands dispatched
  // straight from the room/resource/rack components below.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const focusProject = useCameraStore((s) => s.focusProject);
  const focusResource = useCameraStore((s) => s.focusResource);
  const focusProvider = useCameraStore((s) => s.focusProvider);
  const focusPoint = useCameraStore((s) => s.focusPoint);
  const focusId = useCameraStore((s) => s.focusId);

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
      onPointerMissed={() => selectedProjectId && setSelectedProjectId(null)}
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

      {/* Double-click empty floor = "look here" (focusPoint) — a free, natural
          way to slide the view somewhere without changing zoom/angle. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centerX, -0.06, centerZ]}
        receiveShadow
        onDoubleClick={(e) => {
          e.stopPropagation();
          focusPoint([e.point.x, 0.6, e.point.z]);
        }}
      >
        <planeGeometry args={[layout.radius * 2.2, layout.radius * 2.4]} />
        <meshStandardMaterial color="#0c0f14" roughness={1} />
      </mesh>

      {!reducedGraphics && (
        <ContactShadows position={[centerX, 0.001, centerZ]} opacity={0.45} scale={layout.radius * 2.4} blur={2} far={4} color="#000000" />
      )}

      <Suspense fallback={null}>
        <CorridorScene corridor={layout.corridor} walls={layout.corridorWalls} doors={layout.corridorDoors} />

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
                selectedProviderId={focusId}
                onSelectProvider={onOpenProvider}
                onFocusProvider={(providerId, name) => {
                  const rack = layout.serverRacks.find((r) => r.providerId === providerId);
                  if (!rack) return;
                  focusProvider(providerId, [rack.x, 1, rack.z], 2.5, name);
                }}
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
            // Half-diagonal of the room's own footprint — same idea as the
            // building-wide radius in hq-layout.ts, just scoped to one room.
            const roomRadius = Math.sqrt((room.width / 2) ** 2 + (room.depth / 2) ** 2);
            return (
              <ProjectRoomScene
                key={room.id}
                room={room}
                resources={resourcesByRoom.get(projectId) ?? []}
                selectedResourceId={selectedApplicationId}
                onSelectResource={onSelectApplication}
                onFocusResource={(resourceId, worldPos, name) => focusResource(resourceId, worldPos, name)}
                onSelectNameplate={() => onOpenProject(projectId)}
                selected={selectedProjectId === projectId || focusId === projectId}
                tooltipLines={tooltipLines}
                onSelectRoom={() => setSelectedProjectId(projectId)}
                onFocusRoom={() => focusProject(projectId, [room.x, 1, room.z], roomRadius, project?.name ?? room.name)}
              />
            );
          }
          return null;
        })}

        <TaskAgents layout={layout} applications={applications} workstationPositions={workstationPositions} />
      </Suspense>

      <UniverseCameraController overviewCenter={layout.center} overviewRadius={layout.radius} />
    </Canvas>
  );
}
