import type { AgentState } from "@/server/claude/agent-service";
import type { Actor } from "./sim";

/**
 * Regra que liga o estado REAL do agente à simulação visual (só leitura):
 * - trabalhando, aguardando sua aprovação ou com erro numa ferramenta = tem trabalho: fica na mesa;
 * - ocioso (terminou a resposta / sem sinal) = livre para usar o lounge;
 * - sessão encerrada/offline nem chega aqui: sai da lista e o personagem some.
 */
export function agentNeedsDesk(state: AgentState): boolean {
  return state === "WORKING" || state === "APPROVAL" || state === "ERROR";
}

/** A animação de digitar só liga quando o agente está de fato executando (não esperando aprovação nem parado com erro). */
export function agentIsTyping(state: AgentState): boolean {
  return state === "WORKING";
}

/** Quanto a cadeira da mesa está "puxada para trás" (0 = sob a mesa, 1 = fora): acompanha o personagem. */
export function deskChairAway(actor: Actor | undefined): number {
  if (!actor) return 0;
  if (actor.phase === "desk") return 0;
  if (actor.phase === "sitting" && actor.intent.kind === "work") return 1 - actor.vis.sit;
  return 1;
}
