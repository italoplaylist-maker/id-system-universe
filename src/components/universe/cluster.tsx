"use client";

import { memo } from "react";
import { Text } from "@react-three/drei";
import { Station } from "./station";
import type { ClusterLayout } from "./layout";
import type { UniverseApplication, UniverseProviderSummary } from "@/types/domain";

interface ClusterProps {
  layout: ClusterLayout;
  provider: UniverseProviderSummary;
  applications: UniverseApplication[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const Cluster = memo(function Cluster({ layout, provider, applications, selectedId, onSelect }: ClusterProps) {
  const appsById = new Map(applications.map((a) => [a.id, a]));

  return (
    <group position={[layout.x, 0, layout.z]}>
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <cylinderGeometry args={[layout.radius + 1.1, layout.radius + 1.3, 0.06, 48]} />
        <meshStandardMaterial color={provider.color} emissive={provider.color} emissiveIntensity={0.08} transparent opacity={0.14} />
      </mesh>
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[layout.radius + 1.05, layout.radius + 1.1, 64]} />
        <meshBasicMaterial color={provider.color} transparent opacity={0.5} />
      </mesh>

      <Text position={[0, 0.02, -(layout.radius + 1.6)]} fontSize={0.22} color={provider.color} anchorX="center" anchorY="middle" rotation={[-Math.PI / 2, 0, 0]}>
        {provider.name.toUpperCase()}
      </Text>

      {layout.stations.map((station) => {
        const app = appsById.get(station.applicationId);
        if (!app) return null;
        return (
          <Station
            key={app.id}
            application={app}
            position={[station.x - layout.x, 0, station.z - layout.z]}
            selected={selectedId === app.id}
            onSelect={onSelect}
          />
        );
      })}
    </group>
  );
});
