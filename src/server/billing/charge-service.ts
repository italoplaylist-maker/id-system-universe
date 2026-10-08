import { z } from "zod";
import { Prisma, type Charge, type ChargeReminder, type ReminderDirection } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { addDays, civilToDate, dateToCivil, diffDays, isCivilDate, todayInTimezone, type CivilDate } from "@/lib/civil-date";
import { DEFAULT_REMINDER_RULES, describeRule, type ReminderRuleInput } from "@/lib/billing-defaults";
import { recordAuditEvent, type AuditAction } from "@/server/audit/audit-log";
import { getProjectScope, type ProjectScope } from "@/server/auth/project-access";
import type { SessionUser } from "@/server/auth/session";
import { assertChargeAccess, assertClientAccess, assertScopeAllowsProject, chargeWhere } from "@/server/billing/billing-access";
import { daysOverdue, deriveChargeStatus, UPCOMING_WINDOW_DAYS, type ChargeDisplayStatus } from "@/server/billing/charge-status";
import { materializeReminders, replaceChargeRules, rescheduleReminders, skipPendingReminders, validateRuleInputs } from "@/server/billing/reminders";
import { getBillingSettings } from "@/server/billing/settings";
import { buildVariables, getTemplates, renderTemplate } from "@/server/billing/templates";
import { getWhatsAppProvider, WhatsAppSendError } from "@/server/whatsapp/whatsapp-provider";

export type Actor = { userId: string; ip?: string; userAgent?: string };

export const ruleSchema = z.object({
  direction: z.enum(["BEFORE", "ON", "AFTER"]),
  offsetDays: z.number().int().min(0).max(365),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:mm)."),
  template: z.string().trim().max(1500).nullable().optional(),
  enabled: z.boolean().default(true),
});

const civilSchema = z.string().refine(isCivilDate, "Data inválida (use AAAA-MM-DD).");
const amountSchema = z.number().int("Valor inválido.").min(1, "O valor deve ser maior que zero.").max(9_999_999_999);

export async function resolveReasonId(reasonId?: string | null, reasonName?: string | null): Promise<string | null> {
  if (reasonId) {
    const reason = await prisma.billingReason.findUnique({ where: { id: reasonId }, select: { id: true } });
    if (!reason) throw new ValidationError("Motivo não encontrado.");
    return reason.id;
  }
  const name = reasonName?.trim();
  if (!name) return null;
  const existing = await prisma.billingReason.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing.id;
  return (await prisma.billingReason.create({ data: { name: name.slice(0, 80) } })).id;
}

const createChargeSchema = z.object({
  clientId: z.string().min(1, "Selecione o cliente."),
  projectId: z.string().min(1).nullable().optional(),
  reasonId: z.string().nullable().optional(),
  reasonName: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().min(1, "Informe o motivo da cobrança.").max(300),
  amountCents: amountSchema,
  dueDate: civilSchema,
  competence: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  whatsappEnabled: z.boolean().default(true),
  rules: z.array(ruleSchema).max(20).optional(),
});

export async function createCharge(input: unknown, user: SessionUser, actor: Actor): Promise<{ id: string }> {
  const parsed = createChargeSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  await assertClientAccess(user, data.clientId);
  const scope = await getProjectScope(user);
  assertScopeAllowsProject(scope, data.projectId ?? null);
  const rules = (data.rules ?? DEFAULT_REMINDER_RULES) as ReminderRuleInput[];
  try {
    validateRuleInputs(rules);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Régua inválida.");
  }
  const reasonId = await resolveReasonId(data.reasonId, data.reasonName);
  const settings = await getBillingSettings();

  const charge = await prisma.$transaction(async (tx) => {
    const created = await tx.charge.create({
      data: {
        clientId: data.clientId,
        projectId: data.projectId ?? null,
        reasonId,
        description: data.description,
        amountCents: data.amountCents,
        dueDate: civilToDate(data.dueDate),
        competence: data.competence ?? data.dueDate.slice(0, 7),
        notes: data.notes ?? null,
        whatsappEnabled: data.whatsappEnabled,
        createdByUserId: actor.userId,
      },
    });
    if (rules.length > 0) {
      await tx.chargeReminderRule.createMany({
        data: rules.map((r) => ({ chargeId: created.id, direction: r.direction, offsetDays: r.offsetDays, sendTime: r.sendTime, template: r.template ?? null, enabled: r.enabled })),
      });
      await materializeReminders(tx, created.id, data.dueDate, settings);
    }
    return created;
  });

  await audit(actor, "CHARGE_CREATED", charge, { amountCents: charge.amountCents, dueDate: data.dueDate, clientId: charge.clientId });
  return { id: charge.id };
}

async function audit(actor: Actor | null, action: AuditAction, charge: Pick<Charge, "id" | "projectId">, metadata: Record<string, unknown> = {}) {
  await recordAuditEvent({
    userId: actor?.userId,
    action,
    status: "SUCCESS",
    projectId: charge.projectId,
    entityType: "Charge",
    entityId: charge.id,
    metadata,
    ipAddress: actor?.ip,
    userAgent: actor?.userAgent,
  });
}

const updateChargeSchema = z.object({
  description: z.string().trim().min(1).max(300).optional(),
  amountCents: amountSchema.optional(),
  dueDate: civilSchema.optional(),
  competence: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  whatsappEnabled: z.boolean().optional(),
  projectId: z.string().min(1).nullable().optional(),
  reasonId: z.string().nullable().optional(),
  reasonName: z.string().trim().max(80).nullable().optional(),
  rules: z.array(ruleSchema).max(20).optional(),
});

export async function updateCharge(id: string, input: unknown, user: SessionUser, actor: Actor): Promise<void> {
  await assertChargeAccess(user, id);
  const parsed = updateChargeSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  const existing = await prisma.charge.findUniqueOrThrow({ where: { id } });
  if (existing.status !== "PENDING") throw new ConflictError("Só é possível editar cobranças pendentes.");
  if (data.projectId !== undefined) assertScopeAllowsProject(await getProjectScope(user), data.projectId);
  if (data.rules) {
    try {
      validateRuleInputs(data.rules as ReminderRuleInput[]);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "Régua inválida.");
    }
  }
  const settings = await getBillingSettings();
  const reasonId = data.reasonId !== undefined || data.reasonName !== undefined ? await resolveReasonId(data.reasonId, data.reasonName) : undefined;
  const dueChanged = data.dueDate !== undefined && data.dueDate !== dateToCivil(existing.dueDate);
  const amountChanged = data.amountCents !== undefined && data.amountCents !== existing.amountCents;

  await prisma.$transaction(async (tx) => {
    await tx.charge.update({
      where: { id },
      data: {
        description: data.description,
        amountCents: data.amountCents,
        dueDate: data.dueDate ? civilToDate(data.dueDate) : undefined,
        competence: data.competence,
        notes: data.notes,
        whatsappEnabled: data.whatsappEnabled,
        projectId: data.projectId,
        reasonId,
      },
    });
    if (data.rules) await replaceChargeRules(tx, id, data.rules as ReminderRuleInput[]);
    if (dueChanged || data.rules) await rescheduleReminders(tx, id, data.dueDate ?? dateToCivil(existing.dueDate), settings);
  });

  await audit(actor, "CHARGE_UPDATED", existing, { fields: Object.keys(data) });
  if (amountChanged) await audit(actor, "CHARGE_AMOUNT_CHANGED", existing, { from: existing.amountCents, to: data.amountCents });
  if (dueChanged) await audit(actor, "CHARGE_DUE_DATE_CHANGED", existing, { from: dateToCivil(existing.dueDate), to: data.dueDate });
}

const paySchema = z.object({
  paidAt: civilSchema.optional(),
  amountCents: amountSchema.optional(),
  method: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** Registra pagamento + cancela avisos futuros, tudo na MESMA transação (nunca estado parcial). */
export async function payCharge(id: string, input: unknown, user: SessionUser, actor: Actor): Promise<void> {
  await assertChargeAccess(user, id);
  const parsed = paySchema.safeParse(input ?? {});
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const settings = await getBillingSettings();
  const paidAtCivil = parsed.data.paidAt ?? todayInTimezone(settings.timezone);

  const charge = await prisma.$transaction(async (tx) => {
    // UPDATE condicional: dois cliques/pedidos simultâneos geram UM pagamento.
    const flipped = await tx.charge.updateMany({ where: { id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date() } });
    if (flipped.count === 0) throw new ConflictError("Esta cobrança já foi paga ou cancelada.");
    const row = await tx.charge.findUniqueOrThrow({ where: { id } });
    await tx.chargePayment.create({
      data: {
        chargeId: id,
        amountCents: parsed.data.amountCents ?? row.amountCents,
        paidAt: civilToDate(paidAtCivil),
        method: parsed.data.method ?? null,
        notes: parsed.data.notes ?? null,
        createdByUserId: actor.userId,
      },
    });
    await skipPendingReminders(tx, id, "Cobrança já paga.");
    return row;
  });
  await audit(actor, "CHARGE_PAID", charge, { amountCents: parsed.data.amountCents ?? charge.amountCents, paidAt: paidAtCivil });
}

export async function reversePayment(id: string, user: SessionUser, actor: Actor): Promise<void> {
  await assertChargeAccess(user, id);
  const settings = await getBillingSettings();
  const charge = await prisma.$transaction(async (tx) => {
    const flipped = await tx.charge.updateMany({ where: { id, status: "PAID" }, data: { status: "PENDING", paidAt: null } });
    if (flipped.count === 0) throw new ConflictError("A cobrança não está paga.");
    await tx.chargePayment.updateMany({ where: { chargeId: id, reversedAt: null }, data: { reversedAt: new Date(), reversedByUserId: actor.userId } });
    // Avisos futuros que só foram pulados por causa do pagamento voltam a valer.
    await tx.chargeReminder.updateMany({ where: { chargeId: id, status: "SKIPPED", skippedReason: "Cobrança já paga.", scheduledAt: { gt: new Date() } }, data: { status: "PENDING", skippedReason: null } });
    const row = await tx.charge.findUniqueOrThrow({ where: { id } });
    await materializeReminders(tx, id, dateToCivil(row.dueDate), settings);
    return row;
  });
  await audit(actor, "CHARGE_PAYMENT_REVERSED", charge);
}

export async function cancelCharge(id: string, user: SessionUser, actor: Actor): Promise<void> {
  await assertChargeAccess(user, id);
  const charge = await prisma.$transaction(async (tx) => {
    const flipped = await tx.charge.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (flipped.count === 0) throw new ConflictError("Só é possível cancelar cobranças pendentes.");
    await skipPendingReminders(tx, id, "Cobrança cancelada.");
    return tx.charge.findUniqueOrThrow({ where: { id } });
  });
  await audit(actor, "CHARGE_CANCELLED", charge);
}

// ---------------------------------------------------------------------------
// Listagem / detalhe / resumo
// ---------------------------------------------------------------------------

export type ChargeView = "ALL" | "TODAY" | "UPCOMING" | "OVERDUE" | "PAID";

export interface ChargeFilters {
  view?: ChargeView;
  status?: ChargeDisplayStatus;
  clientId?: string;
  projectId?: string;
  recurrent?: boolean;
  dueFrom?: CivilDate;
  dueTo?: CivilDate;
  q?: string;
  limit?: number;
  offset?: number;
}

function statusWhere(status: ChargeDisplayStatus, today: CivilDate): Prisma.ChargeWhereInput {
  const todayDate = civilToDate(today);
  switch (status) {
    case "PAGA": return { status: "PAID" };
    case "CANCELADA": return { status: "CANCELLED" };
    case "VENCIDA": return { status: "PENDING", dueDate: { lt: todayDate } };
    case "VENCE_HOJE": return { status: "PENDING", dueDate: todayDate };
    case "PENDENTE": return { status: "PENDING", dueDate: { gt: todayDate, lte: civilToDate(addDays(today, UPCOMING_WINDOW_DAYS)) } };
    case "AGENDADA": return { status: "PENDING", dueDate: { gt: civilToDate(addDays(today, UPCOMING_WINDOW_DAYS)) } };
  }
}

function viewWhere(view: ChargeView, today: CivilDate): Prisma.ChargeWhereInput {
  const todayDate = civilToDate(today);
  switch (view) {
    case "TODAY": return { status: "PENDING", dueDate: todayDate };
    case "UPCOMING": return { status: "PENDING", dueDate: { gt: todayDate } };
    case "OVERDUE": return { status: "PENDING", dueDate: { lt: todayDate } };
    case "PAID": return { status: "PAID" };
    default: return {};
  }
}

export function buildChargeWhere(filters: ChargeFilters, scope: ProjectScope, today: CivilDate): Prisma.ChargeWhereInput {
  return {
    AND: [
      chargeWhere(scope),
      filters.view ? viewWhere(filters.view, today) : {},
      filters.status ? statusWhere(filters.status, today) : {},
      filters.clientId ? { clientId: filters.clientId } : {},
      filters.projectId ? { projectId: filters.projectId } : {},
      filters.recurrent === undefined ? {} : filters.recurrent ? { recurrenceId: { not: null } } : { recurrenceId: null },
      filters.dueFrom ? { dueDate: { gte: civilToDate(filters.dueFrom) } } : {},
      filters.dueTo ? { dueDate: { lte: civilToDate(filters.dueTo) } } : {},
      filters.q ? { OR: [{ description: { contains: filters.q, mode: "insensitive" } }, { client: { name: { contains: filters.q, mode: "insensitive" } } }] } : {},
    ],
  };
}

export interface ChargeListItem {
  id: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  recurrenceId: string | null;
  description: string;
  amountCents: number;
  dueDate: CivilDate;
  competence: string | null;
  status: ChargeDisplayStatus;
  daysOverdue: number;
  whatsappEnabled: boolean;
  lastReminderAt: string | null;
}

export async function listCharges(filters: ChargeFilters, user: SessionUser): Promise<{ items: ChargeListItem[]; total: number }> {
  const scope = await getProjectScope(user);
  const settings = await getBillingSettings();
  const today = todayInTimezone(settings.timezone);
  const where = buildChargeWhere(filters, scope, today);
  const [rows, total] = await Promise.all([
    prisma.charge.findMany({
      where,
      include: { client: { select: { name: true, tradeName: true } }, project: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: Math.min(filters.limit ?? 100, 200),
      skip: filters.offset ?? 0,
    }),
    prisma.charge.count({ where }),
  ]);
  const lastReminders = await prisma.chargeReminder.groupBy({ by: ["chargeId"], where: { chargeId: { in: rows.map((r) => r.id) }, status: "SENT" }, _max: { sentAt: true } });
  const lastMap = new Map(lastReminders.map((l) => [l.chargeId, l._max.sentAt]));

  return {
    total,
    items: rows.map((row) => {
      const dueDate = dateToCivil(row.dueDate);
      return {
        id: row.id,
        clientId: row.clientId,
        clientName: row.client.tradeName ?? row.client.name,
        projectId: row.projectId,
        projectName: row.project?.name ?? null,
        recurrenceId: row.recurrenceId,
        description: row.description,
        amountCents: row.amountCents,
        dueDate,
        competence: row.competence,
        status: deriveChargeStatus({ status: row.status, dueDate }, today),
        daysOverdue: row.status === "PENDING" ? daysOverdue(dueDate, today) : 0,
        whatsappEnabled: row.whatsappEnabled,
        lastReminderAt: lastMap.get(row.id)?.toISOString() ?? null,
      };
    }),
  };
}

export interface BillingSummary {
  toReceiveCents: number;
  receivedCents: number;
  overdueCents: number;
  overdueCount: number;
  dueTodayCents: number;
  dueTodayCount: number;
  next7DaysCents: number;
  next7DaysCount: number;
  pendingCount: number;
  recurrences: { activeCount: number; monthlyEquivalentCents: number };
  today: CivilDate;
}

export async function getBillingSummary(filters: Pick<ChargeFilters, "clientId" | "projectId" | "dueFrom" | "dueTo" | "recurrent">, user: SessionUser): Promise<BillingSummary> {
  const scope = await getProjectScope(user);
  const settings = await getBillingSettings();
  const today = todayInTimezone(settings.timezone);
  const todayDate = civilToDate(today);
  const base = buildChargeWhere(filters, scope, today);
  const periodGiven = Boolean(filters.dueFrom || filters.dueTo);
  const monthStart = civilToDate(`${today.slice(0, 7)}-01`);

  const sum = (extra: Prisma.ChargeWhereInput) => prisma.charge.aggregate({ where: { AND: [base, extra] }, _sum: { amountCents: true }, _count: true });
  const [pending, overdue, dueToday, next7, received, recurrences] = await Promise.all([
    sum({ status: "PENDING" }),
    sum({ status: "PENDING", dueDate: { lt: todayDate } }),
    sum({ status: "PENDING", dueDate: todayDate }),
    sum({ status: "PENDING", dueDate: { gt: todayDate, lte: civilToDate(addDays(today, 7)) } }),
    prisma.chargePayment.aggregate({
      // Sem período explícito, "recebido" é o do mês corrente; com período, é o das cobranças do filtro.
      where: { reversedAt: null, charge: { AND: [base] }, ...(periodGiven ? {} : { paidAt: { gte: monthStart } }) },
      _sum: { amountCents: true },
    }),
    prisma.billingRecurrence.findMany({
      where: { status: "ACTIVE", clientId: filters.clientId, projectId: filters.projectId, ...(scope.all ? {} : { projectId: filters.projectId ?? { in: scope.projectIds } }) },
      select: { amountCents: true, period: true, intervalDays: true },
    }),
  ]);

  const monthsPerPeriod: Record<string, number> = { WEEKLY: 12 / 52, MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
  const monthlyEquivalent = recurrences.reduce((total, r) => {
    const months = r.period === "CUSTOM" ? (Math.max(1, r.intervalDays ?? 30) / 30) : monthsPerPeriod[r.period];
    return total + (r.period === "WEEKLY" ? (r.amountCents * 52) / 12 : r.amountCents / months);
  }, 0);

  return {
    toReceiveCents: pending._sum.amountCents ?? 0,
    receivedCents: received._sum.amountCents ?? 0,
    overdueCents: overdue._sum.amountCents ?? 0,
    overdueCount: overdue._count,
    dueTodayCents: dueToday._sum.amountCents ?? 0,
    dueTodayCount: dueToday._count,
    next7DaysCents: next7._sum.amountCents ?? 0,
    next7DaysCount: next7._count,
    pendingCount: pending._count,
    recurrences: { activeCount: recurrences.length, monthlyEquivalentCents: Math.round(monthlyEquivalent) },
    today,
  };
}

/** Só contagens — é o que a Central de Comando (3D) pode mostrar; nunca valores nem nomes. */
export async function getBillingCounts(user: SessionUser): Promise<{ pending: number; overdue: number; dueToday: number }> {
  const scope = await getProjectScope(user);
  const settings = await getBillingSettings();
  const todayDate = civilToDate(todayInTimezone(settings.timezone));
  const where = chargeWhere(scope);
  const [pending, overdue, dueToday] = await Promise.all([
    prisma.charge.count({ where: { AND: [where, { status: "PENDING" }] } }),
    prisma.charge.count({ where: { AND: [where, { status: "PENDING", dueDate: { lt: todayDate } }] } }),
    prisma.charge.count({ where: { AND: [where, { status: "PENDING", dueDate: todayDate }] } }),
  ]);
  return { pending, overdue, dueToday };
}

export interface ChargeDetail extends ChargeListItem {
  notes: string | null;
  reasonName: string | null;
  paidAt: string | null;
  rules: { id: string; description: string; enabled: boolean; sendTime: string; template: string | null; direction: ReminderDirection; offsetDays: number }[];
  reminders: { id: string; description: string; scheduledAt: string; status: ChargeReminder["status"]; attempts: number; sentAt: string | null; reason: string | null }[];
  messages: { id: string; kind: string; status: string; body: string; createdAt: string; sentAt: string | null; error: string | null }[];
  payments: { id: string; amountCents: number; paidAt: string; method: string | null; notes: string | null; reversed: boolean }[];
  audit: { id: string; action: string; createdAt: string; userEmail: string | null; metadata: unknown }[];
  recurrence: { id: string; status: string; period: string } | null;
}

export async function getChargeDetail(id: string, user: SessionUser): Promise<ChargeDetail> {
  await assertChargeAccess(user, id);
  const settings = await getBillingSettings();
  const today = todayInTimezone(settings.timezone);
  const row = await prisma.charge.findUniqueOrThrow({
    where: { id },
    include: {
      client: { select: { name: true, tradeName: true } },
      project: { select: { name: true } },
      reason: { select: { name: true } },
      recurrence: { select: { id: true, status: true, period: true } },
      reminderRules: { orderBy: [{ direction: "asc" }, { offsetDays: "asc" }] },
      reminders: { include: { rule: true }, orderBy: { scheduledAt: "asc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 50 },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  const auditRows = await prisma.auditEvent.findMany({ where: { entityType: "Charge", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { email: true } } } });
  const dueDate = dateToCivil(row.dueDate);

  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.tradeName ?? row.client.name,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    recurrenceId: row.recurrenceId,
    description: row.description,
    amountCents: row.amountCents,
    dueDate,
    competence: row.competence,
    status: deriveChargeStatus({ status: row.status, dueDate }, today),
    daysOverdue: row.status === "PENDING" ? daysOverdue(dueDate, today) : 0,
    whatsappEnabled: row.whatsappEnabled,
    lastReminderAt: row.reminders.filter((r) => r.status === "SENT").map((r) => r.sentAt?.toISOString() ?? "").sort().pop() ?? null,
    notes: row.notes,
    reasonName: row.reason?.name ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    rules: row.reminderRules.map((r) => ({ id: r.id, description: describeRule(r), enabled: r.enabled, sendTime: r.sendTime, template: r.template, direction: r.direction, offsetDays: r.offsetDays })),
    reminders: row.reminders.map((r) => ({ id: r.id, description: describeRule(r.rule), scheduledAt: r.scheduledAt.toISOString(), status: r.status, attempts: r.attempts, sentAt: r.sentAt?.toISOString() ?? null, reason: r.skippedReason ?? r.lastError })),
    messages: row.messages.map((m) => ({ id: m.id, kind: m.kind, status: m.status, body: m.body, createdAt: m.createdAt.toISOString(), sentAt: m.sentAt?.toISOString() ?? null, error: m.error })),
    payments: row.payments.map((p) => ({ id: p.id, amountCents: p.amountCents, paidAt: dateToCivil(p.paidAt), method: p.method, notes: p.notes, reversed: p.reversedAt !== null })),
    audit: auditRows.map((a) => ({ id: a.id, action: a.action, createdAt: a.createdAt.toISOString(), userEmail: a.user?.email ?? null, metadata: a.metadata })),
    recurrence: row.recurrence ? { id: row.recurrence.id, status: row.recurrence.status, period: row.recurrence.period } : null,
  };
}

// ---------------------------------------------------------------------------
// Envio manual
// ---------------------------------------------------------------------------

async function buildManualMessage(chargeId: string): Promise<{ phone: string | null; body: string; direction: ReminderDirection; clientId: string; projectId: string | null; clientName: string }> {
  const settings = await getBillingSettings();
  const today = todayInTimezone(settings.timezone);
  const charge = await prisma.charge.findUniqueOrThrow({ where: { id: chargeId }, include: { client: true, project: { select: { name: true } } } });
  if (charge.status !== "PENDING") throw new ConflictError("Só é possível enviar cobranças pendentes.");
  const dueDate = dateToCivil(charge.dueDate);
  const delta = diffDays(dueDate, today);
  const direction: ReminderDirection = delta > 0 ? "BEFORE" : delta === 0 ? "ON" : "AFTER";
  const templates = await getTemplates();
  const body = renderTemplate(
    templates[direction],
    buildVariables({ clientName: charge.client.tradeName ?? charge.client.name, amountCents: charge.amountCents, dueDate, description: charge.description, projectName: charge.project?.name, competence: charge.competence, overdueDays: daysOverdue(dueDate, today) }),
  );
  return { phone: normalizePhone(charge.client.whatsapp), body, direction, clientId: charge.clientId, projectId: charge.projectId, clientName: charge.client.name };
}

export async function previewChargeMessage(chargeId: string, user: SessionUser): Promise<{ phone: string | null; body: string; direction: ReminderDirection }> {
  await assertChargeAccess(user, chargeId);
  const { phone, body, direction } = await buildManualMessage(chargeId);
  return { phone, body, direction };
}

export async function sendChargeNow(chargeId: string, input: { message?: string }, user: SessionUser, actor: Actor): Promise<{ status: "SENT" | "FAILED"; error?: string }> {
  await assertChargeAccess(user, chargeId);
  const built = await buildManualMessage(chargeId);
  if (!built.phone) throw new ValidationError("O cliente não tem um WhatsApp válido cadastrado.");
  const body = (input.message ?? built.body).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!body || body.length > 1500) throw new ValidationError("Mensagem inválida (vazia ou acima de 1500 caracteres).");

  const message = await prisma.whatsAppMessage.create({ data: { clientId: built.clientId, chargeId, kind: "MANUAL", toPhone: built.phone, body, status: "PROCESSING", createdByUserId: actor.userId } });
  try {
    const provider = await getWhatsAppProvider();
    const result = await provider.sendText(built.phone, body);
    await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId } });
    await audit(actor, "WHATSAPP_MANUAL_SEND", { id: chargeId, projectId: built.projectId }, { messageId: message.id });
    return { status: "SENT" };
  } catch (error) {
    const text = error instanceof WhatsAppSendError || error instanceof Error ? error.message : "Falha no envio.";
    await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: "FAILED", error: text.slice(0, 500) } });
    await recordAuditEvent({ userId: actor.userId, action: "WHATSAPP_MESSAGE_FAILED", status: "FAILED", projectId: built.projectId, entityType: "Charge", entityId: chargeId, metadata: { messageId: message.id }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return { status: "FAILED", error: text };
  }
}

export async function listReasons(): Promise<{ id: string; name: string }[]> {
  return prisma.billingReason.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export { NotFoundError };
