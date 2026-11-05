"use client";

import type { ReactNode } from "react";
import { AgentActors, useLifeSim, type LifeAgent } from "../life/agent-life";
import { LifeContext } from "../life/life-context";
import type { LifeWorldInput } from "../life/world";

/**
 * Dona da simulação visual: mesas (de projetos e de agentes) e lounge leem dela pelo contexto, e
 * todos os personagens — os mesmos de sempre, um por mesa — são desenhados aqui, em qualquer sala.
 */
export function LifeLayer({ world, agents, reduced, children }: { world: LifeWorldInput; agents: LifeAgent[]; reduced: boolean; children: ReactNode }) {
  const sim = useLifeSim(world, agents);
  return (
    <LifeContext.Provider value={sim}>
      {children}
      <AgentActors sim={sim} agents={agents} reduced={reduced} />
    </LifeContext.Provider>
  );
}
