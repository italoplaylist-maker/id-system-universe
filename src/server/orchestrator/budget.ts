import { prisma } from "@/server/db/client";
import { evaluateBudget, type BudgetState } from "@/lib/clt-team";

/** Tokens gastos por um agente (execuções concluídas) desde um instante. */
async function tokensSince(agentId: string, since: Date): Promise<number> {
  const r = await prisma.agentTask.aggregate({ where: { agentId, finishedAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true, cacheTokens: true } });
  return (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0) + (r._sum.cacheTokens ?? 0);
}

/** Início do dia e do mês no fuso do servidor. */
export function windowStarts(now: Date = new Date()): { day: Date; month: Date } {
  return { day: new Date(now.getFullYear(), now.getMonth(), now.getDate()), month: new Date(now.getFullYear(), now.getMonth(), 1) };
}

export async function agentBudget(agentId: string, limits: { dailyTokenLimit: number | null; monthlyTokenLimit: number | null }, now: Date = new Date()): Promise<BudgetState & { usedDay: number; usedMonth: number }> {
  // Sem nenhum limite configurado não há o que consultar (agentes avulsos não pagam essa consulta).
  if (limits.dailyTokenLimit === null && limits.monthlyTokenLimit === null) return { ...evaluateBudget({ usedDay: 0, usedMonth: 0, dailyLimit: null, monthlyLimit: null }), usedDay: 0, usedMonth: 0 };
  const w = windowStarts(now);
  const [usedDay, usedMonth] = await Promise.all([tokensSince(agentId, w.day), tokensSince(agentId, w.month)]);
  return { ...evaluateBudget({ usedDay, usedMonth, dailyLimit: limits.dailyTokenLimit, monthlyLimit: limits.monthlyTokenLimit }), usedDay, usedMonth };
}
