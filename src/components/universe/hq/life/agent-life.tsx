"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { EmployeeModel } from "../assets/employee-model";
import { hashSeed } from "../assets/office-decor";
import { LifeSim, type SyncInput } from "./sim";
import { buildLifeWorldFromPlan, type PlanWorldInput } from "./world";

/** Só para validação visual em máquinas lentas (build de teste); em produção é sempre 1. */
const LIFE_SPEED = Number(process.env.NEXT_PUBLIC_LIFE_SPEED ?? 1) || 1;

export interface LifeAgent {
  id: string;
  accent: string;
  /** Tem trabalho real: trabalhando, aguardando aprovação ou com erro numa ferramenta. */
  mustWork: boolean;
  /** Digitando de verdade (só então a animação de trabalho liga). */
  working: boolean;
}

/** Uma só instância da simulação por cena; a UI só enxerga o objeto estável. */
export function useLifeSim(world: PlanWorldInput | null, agents: LifeAgent[], ready = true): LifeSim {
  const [sim] = useState(() => new LifeSim(Date.now() % 100000));

  const built = useMemo(() => (world ? buildLifeWorldFromPlan(world) : null), [world]);
  const syncKey = agents.map((a) => `${a.id}:${a.mustWork ? 1 : 0}${a.working ? 1 : 0}`).join("|");

  useEffect(() => {
    // Enquanto o estado real não chegou (carregando) ninguém é desenhado: nada de "trabalhando" provisório.
    if (!built || !ready) return;
    sim.setWorld(built);
    const inputs: SyncInput[] = agents.map((a) => ({ id: a.id, seed: hashSeed(a.id), mustWork: a.mustWork, working: a.working }));
    // O primeiro retrato já posiciona cada um onde o estado real manda: ociosos passeando no átrio, trabalhando na mesa.
    sim.sync(inputs, { instant: !sim.initialized });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `syncKey` resume `agents`
  }, [sim, built, syncKey, ready]);

  useFrame((_, delta) => {
    // Quadro longo (GPU lenta/aba em segundo plano) vira vários passos curtos, mas nunca um salto de minutos.
    sim.step(Math.min(delta, 0.4) * LIFE_SPEED);
  });
  return sim;
}

/** Distância da câmera (m) a partir da qual o personagem detalhado (~65 meshes) troca por um boneco simples (2 meshes). Histerese evita piscar. */
const LOD_FAR = 30;
const LOD_NEAR = 26;
const FAR_BODY = new THREE.CapsuleGeometry(0.2, 0.85, 3, 8);
const FAR_HEAD = new THREE.SphereGeometry(0.13, 10, 8);
const FAR_SKIN = new THREE.MeshStandardMaterial({ color: "#d9b89a", roughness: 0.8 });

/** Um personagem: mesma `EmployeeModel` das mesas, agora movido pela simulação (posição, rumo e pose). */
const ActorAvatar = memo(function ActorAvatar({ sim, agent, reduced }: { sim: LifeSim; agent: LifeAgent; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const seed = useMemo(() => hashSeed(agent.id), [agent.id]);
  const visual = sim.visualFor(agent.id);
  const shown = useRef(false);
  const rig = useRef<THREE.Group>(null);
  const far = useRef<THREE.Group>(null);
  const isFar = useRef(false);
  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: agent.accent, roughness: 0.7 }), [agent.accent]);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  useFrame(({ camera }, delta) => {
    const g = group.current;
    const actor = sim.actors.get(agent.id);
    if (!g) return;
    g.visible = !!actor;
    if (!actor) {
      shown.current = false;
      return;
    }
    // A altura segue o piso (átrio +0,40 · alas em níveis próprios); a transição pelas rampas é suavizada.
    const level = sim.levelAt(actor.x, actor.z);
    const y = shown.current ? g.position.y + (level - g.position.y) * Math.min(1, Math.min(delta, 0.1) * 14) : level;
    shown.current = true;
    g.position.set(actor.x, y, actor.z);
    g.rotation.y = actor.yaw;
    // LOD: longe da câmera só um boneco simples é desenhado (o rig detalhado fica invisível: zero draw calls).
    if (far.current && isFar.current) far.current.scale.y = actor.phase === "desk" ? 0.7 : 1;
    const d = camera.position.distanceTo(g.position);
    if (isFar.current ? d < LOD_NEAR : d > LOD_FAR) {
      isFar.current = !isFar.current;
      if (rig.current) rig.current.visible = !isFar.current;
      if (far.current) far.current.visible = isFar.current;
    }
  });
  return (
    <group ref={group} visible={false}>
      <group ref={rig}>
        <EmployeeModel accent={agent.accent} pose="standing" seed={seed} reduced={reduced} visual={visual} />
      </group>
      <group ref={far} visible={false}>
        <mesh geometry={FAR_BODY} material={bodyMat} position={[0, 0.85, 0]} />
        <mesh geometry={FAR_HEAD} material={FAR_SKIN} position={[0, 1.6, 0]} />
      </group>
    </group>
  );
});

export function AgentActors({ sim, agents, reduced }: { sim: LifeSim; agents: LifeAgent[]; reduced: boolean }) {
  return (
    <>
      {agents.map((a) => (
        <ActorAvatar key={a.id} sim={sim} agent={a} reduced={reduced} />
      ))}
    </>
  );
}
