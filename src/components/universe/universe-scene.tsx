"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraRig } from "./camera-rig";
import { Cluster } from "./cluster";
import { TaskAgents } from "./task-agents";
import { AmbientAgent } from "./ambient-agent";
import { computeUniverseLayout } from "./layout";
import type { UniverseApplication, UniverseProviderSummary } from "@/types/domain";

interface UniverseSceneProps {
  providers: UniverseProviderSummary[];
  applications: UniverseApplication[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  reducedGraphics: boolean;
}

export function UniverseScene({ providers, applications, selectedId, onSelect, reducedGraphics }: UniverseSceneProps) {
  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const layout = useMemo(() => computeUniverseLayout(enabledProviders, applications), [enabledProviders, applications]);

  const applicationsByProvider = useMemo(() => {
    const map = new Map<string, UniverseApplication[]>();
    for (const app of applications) {
      const list = map.get(app.providerId) ?? [];
      list.push(app);
      map.set(app.providerId, list);
    }
    return map;
  }, [applications]);

  const stationWorldPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const cluster of layout) {
      for (const station of cluster.stations) {
        map.set(station.applicationId, [station.x, 0, station.z]);
      }
    }
    return map;
  }, [layout]);

  const maxDistance = useMemo(() => Math.max(14, ...layout.map((c) => Math.abs(c.x) + c.radius + 6)), [layout]);

  return (
    <Canvas
      shadows={!reducedGraphics}
      dpr={reducedGraphics ? 1 : [1, 1.6]}
      gl={{ antialias: !reducedGraphics }}
      className="bg-background"
    >
      <color attach="background" args={["#08090c"]} />
      <fog attach="fog" args={["#08090c", maxDistance * 0.9, maxDistance * 2.4]} />

      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 4]} intensity={1.1} castShadow={!reducedGraphics} />
      <pointLight position={[-8, 6, -6]} intensity={0.3} color="#38bdf8" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[maxDistance * 3, maxDistance * 3]} />
        <meshStandardMaterial color="#0b0d12" roughness={1} />
      </mesh>
      <gridHelper args={[maxDistance * 3, Math.round(maxDistance), "#1f232d", "#161922"]} position={[0, -0.01, 0]} />

      <Suspense fallback={null}>
        {layout.map((cluster) => {
          const provider = enabledProviders.find((p) => p.id === cluster.providerId);
          if (!provider) return null;
          return (
            <Cluster
              key={cluster.providerId}
              layout={cluster}
              provider={provider}
              applications={applicationsByProvider.get(cluster.providerId) ?? []}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          );
        })}

        <TaskAgents applications={applications} positions={stationWorldPositions} />

        {!reducedGraphics &&
          layout.map((cluster, i) => <AmbientAgent key={cluster.providerId} center={[cluster.x, cluster.z]} radius={cluster.radius * 0.7} speed={1 + (i % 3) * 0.3} seed={i} />)}
      </Suspense>

      <CameraRig maxDistance={maxDistance} />
    </Canvas>
  );
}
