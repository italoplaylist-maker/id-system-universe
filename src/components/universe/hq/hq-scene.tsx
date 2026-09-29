"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { computeHqLayout, computeWorkstationWorldPositions } from "./hq-layout";
import { HqCamera } from "./hq-camera";
import { CorridorScene } from "./corridor-scene";
import { ReceptionScene } from "./reception-scene";
import { ProjectRoomScene } from "./project-room-scene";
import { CommandCenterScene, type CommandCenterStats } from "./command-center-scene";
import { OperationsScene } from "./operations-scene";
import { ServerRoomScene } from "./server-room-scene";
import { TaskAgents } from "./task-agents";
import type { UniverseApplication, UniverseProject, UniverseProviderSummary } from "@/types/domain";

interface HqSceneProps {
  providers: UniverseProviderSummary[];
  projects: UniverseProject[];
  applications: UniverseApplication[];
  selectedApplicationId: string | null;
  onSelectApplication: (id: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenProvider: (providerId: string) => void;
  onOpenUnassigned: () => void;
  reducedGraphics: boolean;
}

export function HqScene({
  providers,
  projects,
  applications,
  selectedApplicationId,
  onSelectApplication,
  onOpenProject,
  onOpenProvider,
  onOpenUnassigned,
  reducedGraphics,
}: HqSceneProps) {
  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const activeProjects = useMemo(() => projects.filter((p) => !p.archivedAt), [projects]);
  const unassignedCount = useMemo(() => applications.filter((a) => !a.projectId).length, [applications]);

  const layout = useMemo(
    () => computeHqLayout(activeProjects, enabledProviders, unassignedCount),
    [activeProjects, enabledProviders, unassignedCount],
  );

  const resourcesByRoom = useMemo(() => {
    const map = new Map<string, UniverseApplication[]>();
    for (const app of applications) {
      const key = app.projectId ?? "unassigned";
      const list = map.get(key) ?? [];
      list.push(app);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return map;
  }, [applications]);

  const workstationPositions = useMemo(() => computeWorkstationWorldPositions(layout.rooms, resourcesByRoom), [layout.rooms, resourcesByRoom]);

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

  const centerZ = layout.corridor.length / 2;

  return (
    <Canvas shadows={!reducedGraphics} dpr={reducedGraphics ? 1 : [1, 1.6]} gl={{ antialias: !reducedGraphics }} className="bg-background">
      <color attach="background" args={["#08090c"]} />
      <fog attach="fog" args={["#08090c", layout.radius * 1.6, layout.radius * 3.2]} />

      <hemisphereLight args={["#4a5a72", "#05060a", 0.65]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 16, 8]} intensity={1.4} castShadow={!reducedGraphics} />
      <directionalLight position={[-10, 10, centerZ - 6]} intensity={0.35} color="#8fd8ff" />
      <pointLight position={[-6, 6, centerZ]} intensity={0.25} color="#38bdf8" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, centerZ]} receiveShadow>
        <planeGeometry args={[layout.radius * 2.4, layout.radius * 2.6]} />
        <meshStandardMaterial color="#0b0d12" roughness={1} />
      </mesh>

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
            return (
              <ProjectRoomScene
                key={room.id}
                room={room}
                resources={resourcesByRoom.get(projectId) ?? []}
                selectedResourceId={selectedApplicationId}
                onSelectResource={onSelectApplication}
                onSelectNameplate={() => onOpenProject(projectId)}
              />
            );
          }
          if (room.kind === "unassigned") {
            return (
              <ProjectRoomScene
                key={room.id}
                room={room}
                resources={resourcesByRoom.get("unassigned") ?? []}
                selectedResourceId={selectedApplicationId}
                onSelectResource={onSelectApplication}
                onSelectNameplate={onOpenUnassigned}
              />
            );
          }
          return null;
        })}

        <TaskAgents layout={layout} applications={applications} workstationPositions={workstationPositions} />
      </Suspense>

      <HqCamera radius={layout.radius} centerZ={centerZ} focusTarget={null} />
    </Canvas>
  );
}
