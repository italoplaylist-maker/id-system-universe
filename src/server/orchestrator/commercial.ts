import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import {
  COMMERCIAL_ALLOWED_TOOLS, COMMERCIAL_DISALLOWED_TOOLS, COMMERCIAL_ROUTINES, COMMERCIAL_TEAM, COMMERCIAL_TEAM_ID, CYCLE_STEPS, DEFAULT_COMMERCIAL_SETTINGS, LEAD_SEGMENTS, LEAD_STAGE_IDS, MAX_RADIUS_KM,
  cycleKey, funnelMetrics, isStale, nextCycleStep, operatingCost, parseCycleKey, type CommercialSlug,
} from "@/lib/commercial-team";
import { orchestratorBus } from "./bus";
import { agentBudget } from "./budget";
import { workspaceRoot } from "./workspace";
import { teamOverview, type CltOverview } from "./clt";
import { ACTIVE, submitSystemTask } from "./service";

type Actor = { userId: string; ip?: string; userAgent?: string };

/** Pasta neutra da equipe comercial: não é a de nenhum projeto e não tem código (eles nem têm ferramenta de arquivo). */
export function commercialWorkspace(): string {
  return process.env.COMMERCIAL_AGENTS_CWD?.trim() || join(workspaceRoot(), "comercial");
}

// ---------------------------------------------------------------------------
// Criação da equipe
// ---------------------------------------------------------------------------

export async function ensureCommercialTeam(actor: Actor): Promise<{ created: string[]; existing: string[] }> {
  await prisma.commercialSettings.upsert({ where: { id: "default" }, create: { id: "default", baseCity: DEFAULT_COMMERCIAL_SETTINGS.baseCity, radiusKm: DEFAULT_COMMERCIAL_SETTINGS.radiusKm, segments: DEFAULT_COMMERCIAL_SETTINGS.segments, maxNewLeadsPerRun: DEFAULT_COMMERCIAL_SETTINGS.maxNewLeadsPerRun }, update: {} });
  const existingRows = await prisma.agentProfile.findMany({ where: { slug: { in: COMMERCIAL_TEAM.map((a) => a.slug) } }, select: { slug: true } });
  const have = new Set(existingRows.map((r) => r.slug));
  const missing = COMMERCIAL_TEAM.filter((a) => !have.has(a.slug));
  const cwd = commercialWorkspace();
  if (!cwd.startsWith("/")) throw new ValidationError("COMMERCIAL_AGENTS_CWD deve ser um caminho absoluto no servidor.");

  const created: string[] = [];
  if (missing.length > 0) {
    const last = await prisma.agentProfile.aggregate({ _max: { position: true } });
    let position = (last._max.position ?? -1) + 1;
    for (const def of missing) {
      await prisma.agentProfile.create({
        data: {
          name: def.name, specialty: def.specialty, cwd, model: def.model, effort: def.effort, permissionMode: "default",
          allowedTools: COMMERCIAL_ALLOWED_TOOLS, disallowedTools: COMMERCIAL_DISALLOWED_TOOLS,
          team: COMMERCIAL_TEAM_ID, slug: def.slug, roleTitle: def.roleTitle, description: def.description,
          dailyTokenLimit: def.dailyTokenLimit, monthlyTokenLimit: def.monthlyTokenLimit, position: position++,
        },
      });
      created.push(def.slug);
    }
  }
  // Rotinas (idempotente por agente + nome). Nascem DESLIGADAS: o Italo liga depois de conferir região, segmentos e frequência.
  const agents = await prisma.agentProfile.findMany({ where: { slug: { in: COMMERCIAL_TEAM.map((a) => a.slug) }, archivedAt: null }, select: { id: true, slug: true } });
  for (const r of COMMERCIAL_ROUTINES) {
    const agent = agents.find((a) => a.slug === r.slug);
    if (!agent) continue;
    const has = await prisma.agentRoutine.findFirst({ where: { agentId: agent.id, name: r.name }, select: { id: true } });
    if (!has) await prisma.agentRoutine.create({ data: { agentId: agent.id, name: r.name, prompt: r.prompt, days: r.days, time: r.time, priority: r.priority, gate: r.gate, enabled: r.enabled } });
  }
  if (created.length > 0) {
    await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_CREATED", status: "SUCCESS", entityType: "AgentProfile", entityId: "commercial-team", metadata: { team: COMMERCIAL_TEAM_ID, created }, ipAddress: actor.ip, userAgent: actor.userAgent });
    orchestratorBus.emit({ type: "agent", agentId: "commercial-team" });
  }
  return { created, existing: [...have].filter((s): s is string => !!s) };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export const settingsSchema = z.object({
  baseCity: z.string().trim().min(2).max(80).optional(),
  radiusKm: z.number().int().min(1).max(MAX_RADIUS_KM).optional(),
  segments: z.array(z.enum(LEAD_SEGMENTS)).min(1).max(LEAD_SEGMENTS.length).optional(),
  maxNewLeadsPerRun: z.number().int().min(1).max(50).optional(),
  costPerMillionTokens: z.number().min(0).max(10_000).nullable().optional(),
});
export type CommercialSettingsView = { baseCity: string; radiusKm: number; segments: string[]; maxNewLeadsPerRun: number; costPerMillionTokens: number | null };

export async function getCommercialSettings(): Promise<CommercialSettingsView> {
  const s = await prisma.commercialSettings.findUnique({ where: { id: "default" } });
  return s ? { baseCity: s.baseCity, radiusKm: s.radiusKm, segments: s.segments, maxNewLeadsPerRun: s.maxNewLeadsPerRun, costPerMillionTokens: s.costPerMillionTokens } : { ...DEFAULT_COMMERCIAL_SETTINGS, costPerMillionTokens: null };
}

export async function updateCommercialSettings(input: unknown, actor: Actor): Promise<CommercialSettingsView> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Configuração inválida.");
  const d = parsed.data;
  await prisma.commercialSettings.upsert({
    where: { id: "default" },
    create: { id: "default", baseCity: d.baseCity ?? DEFAULT_COMMERCIAL_SETTINGS.baseCity, radiusKm: d.radiusKm ?? DEFAULT_COMMERCIAL_SETTINGS.radiusKm, segments: d.segments ?? DEFAULT_COMMERCIAL_SETTINGS.segments, maxNewLeadsPerRun: d.maxNewLeadsPerRun ?? DEFAULT_COMMERCIAL_SETTINGS.maxNewLeadsPerRun, costPerMillionTokens: d.costPerMillionTokens ?? null },
    update: { ...(d.baseCity !== undefined ? { baseCity: d.baseCity } : {}), ...(d.radiusKm !== undefined ? { radiusKm: d.radiusKm } : {}), ...(d.segments !== undefined ? { segments: d.segments } : {}), ...(d.maxNewLeadsPerRun !== undefined ? { maxNewLeadsPerRun: d.maxNewLeadsPerRun } : {}), ...(d.costPerMillionTokens !== undefined ? { costPerMillionTokens: d.costPerMillionTokens } : {}) },
  });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "CommercialSettings", entityId: "default", metadata: { fields: Object.keys(d) }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return getCommercialSettings();
}

// ---------------------------------------------------------------------------
// Visão geral (indicadores REAIS do banco)
// ---------------------------------------------------------------------------

export interface LeadView {
  id: string; name: string; segment: string; city: string | null; phone: string | null; website: string | null; distanceKm: number | null;
  source: string; foundAt: string; foundBy: string; stage: string; priority: string | null; priorityReason: string | null; productFit: string | null;
  painPoints: string | null; missingInfo: string | null; conversionNote: string | null; techNeed: string | null; discarded: boolean; discardReason: string | null;
  lastContactAt: string | null; updatedAt: string; stale: boolean;
}
export interface PendingApproachView { id: string; leadId: string; leadName: string; channel: string | null; content: string; agentName: string; createdAt: string; kind: string }
export interface CommercialOverview {
  team: CltOverview;
  exists: boolean;
  settings: CommercialSettingsView;
  indicators: {
    leadsFound: number; qualified: number; researched: number; open: number; pendingApproaches: number; converted: number; lost: number; conversionRate: number | null;
    stale: number; tokensMonth: number; tokensDay: number; costMonth: number | null;
  };
  leads: LeadView[];
  pending: PendingApproachView[];
  cycle: { running: boolean; step: number | null; label: string | null };
}

const leadView = (l: { id: string; name: string; segment: string; city: string | null; phone: string | null; website: string | null; distanceKm: number | null; source: string; foundAt: Date; foundBy: string; stage: string; priority: string | null; priorityReason: string | null; productFit: string | null; painPoints: string | null; missingInfo: string | null; conversionNote: string | null; techNeed: string | null; discarded: boolean; discardReason: string | null; lastContactAt: Date | null; updatedAt: Date }, now: Date): LeadView => ({
  id: l.id, name: l.name, segment: l.segment, city: l.city, phone: l.phone, website: l.website, distanceKm: l.distanceKm, source: l.source, foundAt: l.foundAt.toISOString(), foundBy: l.foundBy, stage: l.stage,
  priority: l.priority, priorityReason: l.priorityReason, productFit: l.productFit, painPoints: l.painPoints, missingInfo: l.missingInfo, conversionNote: l.conversionNote, techNeed: l.techNeed,
  discarded: l.discarded, discardReason: l.discardReason, lastContactAt: l.lastContactAt?.toISOString() ?? null, updatedAt: l.updatedAt.toISOString(), stale: !l.discarded && isStale(l, now),
});

export async function commercialOverview(now: Date = new Date()): Promise<CommercialOverview> {
  const [team, settings, total, discarded, qualified, open, converted, lost, pendingRows, leads, running] = await Promise.all([
    teamOverview(COMMERCIAL_TEAM_ID, commercialWorkspace(), now),
    getCommercialSettings(),
    prisma.lead.count(),
    prisma.lead.count({ where: { discarded: true } }),
    prisma.lead.count({ where: { discarded: false, stage: { in: ["QUALIFICADO", "AGUARDANDO_ABORDAGEM", "PRIMEIRO_CONTATO", "EM_NEGOCIACAO", "CONVERTIDO"] } } }),
    prisma.lead.count({ where: { discarded: false, stage: { notIn: ["CONVERTIDO", "PERDIDO"] } } }),
    prisma.lead.count({ where: { discarded: false, stage: "CONVERTIDO" } }),
    prisma.lead.count({ where: { stage: "PERDIDO" } }),
    prisma.leadInteraction.findMany({ where: { status: "PENDENTE_APROVACAO" }, orderBy: { createdAt: "asc" }, take: 30, include: { lead: { select: { name: true } } } }),
    prisma.lead.findMany({ orderBy: { updatedAt: "desc" }, take: 80 }),
    prisma.agentTask.findFirst({ where: { idempotencyKey: { startsWith: "cycle:" }, status: { in: ["QUEUED", ...ACTIVE] } }, select: { idempotencyKey: true } }),
  ]);
  const m = funnelMetrics({ total, discarded, qualified, open, pendingApproaches: pendingRows.length, converted });
  const staleCount = leads.filter((l) => !l.discarded && isStale(l, now)).length;
  const cycleRef = parseCycleKey(running?.idempotencyKey);
  return {
    team,
    exists: team.agents.length > 0,
    settings,
    indicators: {
      leadsFound: total - discarded, qualified: m.qualified, researched: total, open: m.open, pendingApproaches: m.pendingApproaches, converted: m.converted, lost, conversionRate: m.conversionRate, stale: staleCount,
      tokensMonth: team.totals.tokensMonth, tokensDay: team.totals.tokensDay, costMonth: operatingCost(team.totals.tokensMonth, settings.costPerMillionTokens),
    },
    leads: leads.map((l) => leadView(l, now)),
    pending: pendingRows.map((p) => ({ id: p.id, leadId: p.leadId, leadName: p.lead.name, channel: p.channel, content: p.content, agentName: p.agentName, createdAt: p.createdAt.toISOString(), kind: p.kind })),
    cycle: { running: Boolean(running), step: cycleRef?.step ?? null, label: cycleRef ? CYCLE_STEPS[cycleRef.step]?.label ?? null : null },
  };
}

// ---------------------------------------------------------------------------
// Decisões humanas
// ---------------------------------------------------------------------------

export async function decideInteraction(id: string, decision: "approve" | "reject" | "sent", actor: Actor): Promise<void> {
  const row = await prisma.leadInteraction.findUnique({ where: { id }, include: { lead: true } });
  if (!row) throw new NotFoundError("Rascunho não encontrado.");
  if (row.status !== "PENDENTE_APROVACAO" && !(decision === "sent" && row.status === "APROVADO")) throw new ValidationError("Este rascunho já foi decidido.");
  const status = decision === "approve" ? "APROVADO" : decision === "reject" ? "REJEITADO" : "ENVIADO";
  await prisma.leadInteraction.update({ where: { id }, data: { status, decidedAt: new Date(), decidedById: actor.userId } });
  if (decision === "sent") {
    // Quem enviou foi o Italo, por fora do Universe: aqui só se registra o fato (contato real) e o funil anda.
    await prisma.lead.update({ where: { id: row.leadId }, data: { lastContactAt: new Date(), stage: ["AGUARDANDO_ABORDAGEM", "QUALIFICADO"].includes(row.lead.stage) ? "PRIMEIRO_CONTATO" : row.lead.stage } });
  }
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "LeadInteraction", entityId: id, metadata: { event: `approach_${decision}`, leadId: row.leadId }, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent" });
}

export async function setLeadStage(id: string, input: { stage?: string; discarded?: boolean; note?: string }, actor: Actor): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new NotFoundError("Lead não encontrado.");
  if (input.stage !== undefined && !(LEAD_STAGE_IDS as string[]).includes(input.stage)) throw new ValidationError("Etapa inválida.");
  await prisma.lead.update({ where: { id }, data: { ...(input.stage ? { stage: input.stage } : {}), ...(input.discarded !== undefined ? { discarded: input.discarded, discardReason: input.discarded ? (input.note ?? "Descartado pelo Italo") : null } : {}) } });
  await prisma.leadInteraction.create({ data: { leadId: id, kind: "ETAPA", content: `${input.stage ? `Etapa → ${input.stage}. ` : ""}${input.discarded !== undefined ? (input.discarded ? "Descartado. " : "Reaberto. ") : ""}${input.note ?? ""}`.trim(), agentName: "Italo (manual)" } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "Lead", entityId: id, metadata: { stage: input.stage, discarded: input.discarded }, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent" });
}

// ---------------------------------------------------------------------------
// Ciclo coordenado (Garimpeiro → Analista → CRM → Vendedor), sem loop
// ---------------------------------------------------------------------------

async function submitCycleStep(cycleId: string, step: number): Promise<{ ok: boolean; reason?: string }> {
  const def = CYCLE_STEPS[step];
  const agent = await prisma.agentProfile.findFirst({ where: { team: COMMERCIAL_TEAM_ID, slug: def.slug, archivedAt: null } });
  if (!agent) return { ok: false, reason: `${def.label}: o agente não existe` };
  if (agent.paused) return { ok: false, reason: `${def.label}: ${agent.name} está pausado` };
  const budget = await agentBudget(agent.id, { dailyTokenLimit: agent.dailyTokenLimit, monthlyTokenLimit: agent.monthlyTokenLimit });
  if (budget.blocked) return { ok: false, reason: `${def.label}: ${budget.reason}` };
  await submitSystemTask({ agentId: agent.id, prompt: def.prompt, idempotencyKey: cycleKey(cycleId, step), priority: 0 });
  return { ok: true };
}

/** "Executar ciclo agora": um ciclo por vez; cada passo só nasce quando o anterior termina com sucesso. */
export async function startCommercialCycle(actor: Actor): Promise<{ cycleId: string }> {
  const busy = await prisma.agentTask.findFirst({ where: { idempotencyKey: { startsWith: "cycle:" }, status: { in: ["QUEUED", ...ACTIVE] } }, select: { id: true } });
  if (busy) throw new ValidationError("Já há um ciclo comercial em andamento.");
  const cycleId = randomUUID().slice(0, 12);
  const first = await submitCycleStep(cycleId, 0);
  if (!first.ok) throw new ValidationError(`Não consegui iniciar o ciclo: ${first.reason}.`);
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_TASK_SUBMITTED", status: "SUCCESS", entityType: "CommercialCycle", entityId: cycleId, metadata: { event: "cycle_started" }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return { cycleId };
}

/** Chamado quando QUALQUER tarefa termina: se era um passo de ciclo e deu certo, começa o próximo. Falha ou orçamento esgotado = o ciclo para. */
export async function advanceCommercialCycle(taskId: string, status: "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED"): Promise<void> {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { idempotencyKey: true } });
  const ref = parseCycleKey(task?.idempotencyKey);
  if (!ref) return;
  const next = nextCycleStep(ref.step, status);
  if (next === null) {
    if (status !== "COMPLETED") logger.warn("commercial_cycle_stopped", { cycleId: ref.cycleId, step: ref.step, status });
    return;
  }
  const r = await submitCycleStep(ref.cycleId, next);
  if (!r.ok) logger.warn("commercial_cycle_stopped", { cycleId: ref.cycleId, step: next, reason: r.reason });
}

export const COMMERCIAL_SLUGS: CommercialSlug[] = COMMERCIAL_TEAM.map((a) => a.slug);
