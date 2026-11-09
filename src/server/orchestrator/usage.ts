import { prisma } from "@/server/db/client";

import { mapPlanUsage, type ClaudeUsageView, type RawPlanUsage } from "@/lib/claude-usage";

export type { ClaudeUsageView } from "@/lib/claude-usage";

interface PlanCache {
  at: number;
  value: RawPlanUsage | null;
  error: string | null;
}
let planCache: PlanCache | null = null;
let inflight: Promise<PlanCache> | null = null;
const TTL_MS = 60_000;

async function fetchPlan(): Promise<PlanCache> {
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    // Entrada em streaming que nunca envia mensagem: só abre o processo para perguntar o uso e fecha.
    async function* silence(): AsyncGenerator<never> {
      await new Promise(() => undefined);
    }
    const q = query({ prompt: silence(), options: { cwd: process.env.HOME || "/", settingSources: [] } });
    try {
      // API experimental do SDK (pode mudar): qualquer falha vira "indisponível" no painel, sem derrubar nada.
      const raw = await Promise.race([
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("O Claude não respondeu a tempo.")), 25_000)),
      ]);
      return { at: Date.now(), value: raw as RawPlanUsage, error: null };
    } finally {
      q.close();
    }
  } catch (e) {
    return { at: Date.now(), value: null, error: e instanceof Error ? e.message : "Não foi possível consultar o plano." };
  }
}

async function planUsage(force: boolean): Promise<PlanCache> {
  if (!force && planCache && Date.now() - planCache.at < TTL_MS) return planCache;
  inflight ??= fetchPlan()
    .then((r) => (planCache = r))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function tokensSince(since: Date) {
  const r = await prisma.agentTask.aggregate({
    where: { finishedAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true, cacheTokens: true },
  });
  const input = r._sum.inputTokens ?? 0;
  const output = r._sum.outputTokens ?? 0;
  return { total: input + output + (r._sum.cacheTokens ?? 0), input, output };
}

export async function getClaudeUsage(force = false): Promise<ClaudeUsageView> {
  const now = Date.now();
  const [plan, day, week] = await Promise.all([planUsage(force), tokensSince(new Date(now - 24 * 3600_000)), tokensSince(new Date(now - 7 * 24 * 3600_000))]);
  return {
    ...mapPlanUsage(plan.value),
    tokens: { day: day.total, week: week.total, dayInput: day.input, dayOutput: day.output },
    error: plan.error,
    at: new Date(now).toISOString(),
  };
}
