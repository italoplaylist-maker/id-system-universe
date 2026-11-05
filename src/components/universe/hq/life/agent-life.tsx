"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { EmployeeModel } from "../assets/employee-model";
import { hashSeed } from "../assets/office-decor";
import { LifeSim, type SyncInput } from "./sim";
import { buildLifeWorld, type LifeWorldInput } from "./world";

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
export function useLifeSim(world: LifeWorldInput | null, agents: LifeAgent[], ready = true): LifeSim {
  const [sim] = useState(() => new LifeSim(Date.now() % 100000));

  const built = useMemo(() => (world ? buildLifeWorld(world) : null), [world]);
  const syncKey = agents.map((a) => `${a.id}:${a.mustWork ? 1 : 0}${a.working ? 1 : 0}`).join("|");

  useEffect(() => {
    // Enquanto o estado real não chegou (carregando) ninguém é desenhado: nada de "trabalhando" provisório.
    if (!built || !ready) return;
    sim.setWorld(built);
    const inputs: SyncInput[] = agents.map((a) => ({ id: a.id, seed: hashSeed(a.id), mustWork: a.mustWork, working: a.working }));
    // O primeiro retrato já posiciona cada um onde o estado real manda: ociosos no lounge, trabalhando na mesa.
    sim.sync(inputs, { instant: !sim.initialized });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `syncKey` resume `agents`
  }, [sim, built, syncKey, ready]);

  useFrame((_, delta) => {
    // Quadro longo (GPU lenta/aba em segundo plano) vira vários passos curtos, mas nunca um salto de minutos.
    sim.step(Math.min(delta, 0.4) * LIFE_SPEED);
  });
  return sim;
}

/** Um personagem: mesma `EmployeeModel` das mesas, agora movido pela simulação (posição, rumo e pose). */
const ActorAvatar = memo(function ActorAvatar({ sim, agent, reduced }: { sim: LifeSim; agent: LifeAgent; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const seed = useMemo(() => hashSeed(agent.id), [agent.id]);
  const visual = sim.visualFor(agent.id);
  useFrame(() => {
    const g = group.current;
    const actor = sim.actors.get(agent.id);
    if (!g) return;
    g.visible = !!actor;
    if (!actor) return;
    g.position.set(actor.x, 0, actor.z);
    g.rotation.y = actor.yaw;
  });
  return (
    <group ref={group} visible={false}>
      <EmployeeModel accent={agent.accent} pose="standing" seed={seed} reduced={reduced} visual={visual} />
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
