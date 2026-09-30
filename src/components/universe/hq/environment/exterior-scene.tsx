"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface Placement {
  x: number;
  z: number;
  scale: number;
  rotation: number;
}

/** Deterministic ring of placements around the building footprint — fixed, never reshuffled. */
function ringPlacements(count: number, minRadius: number, maxRadius: number, seed: number): Placement[] {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
    const r = minRadius + rand() * (maxRadius - minRadius);
    out.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r, scale: 0.8 + rand() * 0.5, rotation: rand() * Math.PI * 2 });
  }
  return out;
}

function InstancedTrees({ placements }: { placements: Placement[] }) {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const foliageRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    placements.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, 0.35 * p.scale, p.z), new THREE.Quaternion(), new THREE.Vector3(p.scale, p.scale, p.scale));
      trunkRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, 0.95 * p.scale, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotation, 0)), new THREE.Vector3(p.scale, p.scale, p.scale));
      foliageRef.current?.setMatrixAt(i, m);
    });
    if (trunkRef.current) trunkRef.current.instanceMatrix.needsUpdate = true;
    if (foliageRef.current) foliageRef.current.instanceMatrix.needsUpdate = true;
  }, [placements]);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, placements.length]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 0.7, 6]} />
        <meshStandardMaterial color="#4a3a2c" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[undefined, undefined, placements.length]} castShadow>
        <coneGeometry args={[0.75, 1.5, 7]} />
        <meshStandardMaterial color="#2f6b45" roughness={0.85} />
      </instancedMesh>
    </group>
  );
}

function InstancedLampPosts({ placements, nightFactor }: { placements: Placement[]; nightFactor: number }) {
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const headMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    placements.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, 1.1, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      poleRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, 2.25, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      headRef.current?.setMatrixAt(i, m);
    });
    if (poleRef.current) poleRef.current.instanceMatrix.needsUpdate = true;
    if (headRef.current) headRef.current.instanceMatrix.needsUpdate = true;
  }, [placements]);

  useEffect(() => {
    if (headMaterialRef.current) headMaterialRef.current.emissiveIntensity = 0.15 + nightFactor * 1.6;
  }, [nightFactor]);

  return (
    <group>
      <instancedMesh ref={poleRef} args={[undefined, undefined, placements.length]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, 2.2, 6]} />
        <meshStandardMaterial color="#2a323e" metalness={0.5} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, placements.length]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial ref={headMaterialRef} color="#fff3d6" emissive="#ffdca0" emissiveIntensity={0.15} />
      </instancedMesh>
    </group>
  );
}

export function ExteriorScene({
  center,
  buildingRadius,
  nightFactor,
  reducedGraphics,
}: {
  center: [number, number, number];
  buildingRadius: number;
  nightFactor: number;
  reducedGraphics: boolean;
}) {
  const [cx, , cz] = center;
  const groundSize = Math.max(buildingRadius * 6, 60);
  const sidewalkInner = buildingRadius * 1.02;
  const sidewalkOuter = buildingRadius * 1.18;

  const trees = useMemo(() => ringPlacements(16, buildingRadius * 1.35, buildingRadius * 2.1, 7), [buildingRadius]);
  const lamps = useMemo(() => ringPlacements(6, buildingRadius * 1.22, buildingRadius * 1.24, 91), [buildingRadius]);

  return (
    <group position={[cx, 0, cz]}>
      {/* Lawn */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color="#1f3a26" roughness={1} />
      </mesh>

      {/* Sidewalk ring around the building */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]} receiveShadow>
        <ringGeometry args={[sidewalkInner, sidewalkOuter, 48]} />
        <meshStandardMaterial color="#5c6472" roughness={0.95} />
      </mesh>

      {/* Entrance path, toward the building's open (north) front */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.065, buildingRadius * 1.6]} receiveShadow>
        <planeGeometry args={[buildingRadius * 0.5, buildingRadius * 0.9]} />
        <meshStandardMaterial color="#63697a" roughness={0.9} />
      </mesh>

      {/* Small parking lot, off to one side */}
      <group position={[-buildingRadius * 2.1, -0.065, buildingRadius * 0.4]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[buildingRadius * 1.5, buildingRadius * 1.5]} />
          <meshStandardMaterial color="#2c2f36" roughness={0.9} />
        </mesh>
        {[-1, 0, 1].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[i * buildingRadius * 0.35, 0.001, 0]}>
            <planeGeometry args={[0.05, buildingRadius * 1.1]} />
            <meshBasicMaterial color="#c9cdd6" transparent opacity={0.5} />
          </mesh>
        ))}
      </group>

      {!reducedGraphics && <InstancedTrees placements={trees} />}
      <InstancedLampPosts placements={lamps} nightFactor={nightFactor} />
    </group>
  );
}
