import { z } from "zod";
import type { RecurrenceStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ConflictError, ValidationError } from "@/lib/errors";
import { civilToDate, dateToCivil, isCivilDate } from "@/lib/civil-date";
import { DEFAULT_REMINDER_RULES, type ReminderRuleInput } from "@/lib/billing-defaults";
import { recordAuditEvent, type AuditAction } from "@/server/audit/audit-log";
import { getProjectScope } from "@/server/auth/project-access";
import type { SessionUser } from "@/server/auth/session";
import { assertClientAccess, assertRecurrenceAccess, assertScopeAllowsProject, recurrenceWhere } from "@/server/billing/billing-access";
import { resolveReasonId, ruleSchema, type Actor } from "@/server/billing/charge-service";
import { generateChargesForRecurrence } from "@/server/billing/recurrence";
import { validateRuleInputs } from "@/server/billing/reminders";
import { getBillingSettings } from "@/server/billing/settings";

const civilSchema = z.string().refine(isCivilDate, "Data inválida (use AAAA-MM-DD).");

const recurrenceSchema = z.object({
  clientId: z.string().min(1, "Selecione o cliente."),
  projectId: z.string().min(1).nullable().optional(),
  reasonId: z.string().nullable().optional(),
  reasonName: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().min(1, "Informe o motivo da cobrança.").max(300),
  amountCents: z.number().int().min(1, "O valor deve ser maior que zero.").max(9_999_999_999),
  period: z.enum(["WEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM"]),
  intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
  startDate: civilSchema,
  endDate: civilSchema.nullable().optional(),
  whatsappEnabled: z.boolean().default(true),
  notes: z.string().trim().max(2000).nullable().optional(),
  rules: z.array(ruleSchema).max(20).optional(),
});

function validateShape(data: z.infer<typeof recurrenceSchema>): void {
  if (data.period === "CUSTOM" && !data.intervalDays) throw new ValidationError("Informe o intervalo em dias da periodicidade personalizada.");
  if (data.endDate && data.endDate < data.startDate) throw new ValidationError("A data final não pode ser anterior à inicial.");
}

async function audit(actor: Actor, action: AuditAction, recurrence: { id: string; projectId: string | null }, metadata: Record<string, unknown> = {}) {
  await recordAuditEvent({ userId: actor.userId, action, status: "SUCCESS", projectId: recurrence.projectId, entityType: "BillingRecurrence", entityId: recurrence.id, metadata, ipAddress: actor.ip, userAgent: actor.userAgent });
}

export async function createRecurrence(input: unknown, user: SessionUser, actor: Actor): Promise<{ id: string; chargesCreated: number }> {
  const parsed = recurrenceSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  validateShape(data);
  await assertClientAccess(user, data.clientId);
  assertScopeAllowsProject(await getProjectScope(user), data.projectId ?? null);
  const rules = (data.rules ?? DEFAULT_REMINDER_RULES) as ReminderRuleInput[];
  try {
    validateRuleInputs(rules);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Régua inválida.");
  }
  const reasonId = await resolveReasonId(data.reasonId, data.reasonName);

  const recurrence = await prisma.billingRecurrence.create({
    data: {
      clientId: data.clientId,
      projectId: data.projectId ?? null,
      reasonId,
      description: data.description,
      amountCents: data.amountCents,
      period: data.period,
      intervalDays: data.period === "CUSTOM" ? data.intervalDays : null,
      dueDay: ["WEEKLY", "CUSTOM"].includes(data.period) ? null : (data.dueDay ?? Number(data.startDate.slice(8, 10))),
      startDate: civilToDate(data.startDate),
      endDate: data.endDate ? civilToDate(data.endDate) : null,
      whatsappEnabled: data.whatsappEnabled,
      notes: data.notes ?? null,
      createdByUserId: actor.userId,
      reminderRules: { create: rules.map((r) => ({ direction: r.direction, offsetDays: r.offsetDays, sendTime: r.sendTime, template: r.template ?? null, enabled: r.enabled })) },
    },
  });
  const chargesCreated = await generateChargesForRecurrence(recurrence, await getBillingSettings(), new Date());
  await audit(actor, "RECURRENCE_CREATED", recurrence, { period: data.period, amountCents: data.amountCents, startDate: data.startDate });
  return { id: recurrence.id, chargesCreated };
}

const updateSchema = recurrenceSchema.partial().omit({ clientId: true, startDate: true, period: true });

/** Mudanças valem para as PRÓXIMAS cobranças geradas; as já geradas permanecem como estão. */
export async function updateRecurrence(id: string, input: unknown, user: SessionUser, actor: Actor): Promise<void> {
  await assertRecurrenceAccess(user, id);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  if (data.projectId !== undefined) assertScopeAllowsProject(await getProjectScope(user), data.projectId);
  const reasonId = data.reasonId !== undefined || data.reasonName !== undefined ? await resolveReasonId(data.reasonId, data.reasonName) : undefined;
  if (data.rules) {
    try {
      validateRuleInputs(data.rules as ReminderRuleInput[]);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "Régua inválida.");
    }
  }
  const existing = await prisma.billingRecurrence.findUniqueOrThrow({ where: { id } });
  if (data.endDate && data.endDate < dateToCivil(existing.startDate)) throw new ValidationError("A data final não pode ser anterior à inicial.");

  await prisma.$transaction(async (tx) => {
    await tx.billingRecurrence.update({
      where: { id },
      data: {
        description: data.description,
        amountCents: data.amountCents,
        dueDay: data.dueDay,
        endDate: data.endDate === undefined ? undefined : data.endDate ? civilToDate(data.endDate) : null,
        whatsappEnabled: data.whatsappEnabled,
        notes: data.notes,
        projectId: data.projectId,
        reasonId,
      },
    });
    if (data.rules) {
      await tx.chargeReminderRule.deleteMany({ where: { recurrenceId: id } });
      await tx.chargeReminderRule.createMany({ data: data.rules.map((r) => ({ recurrenceId: id, direction: r.direction, offsetDays: r.offsetDays, sendTime: r.sendTime, template: r.template ?? null, enabled: r.enabled })) });
    }
  });
  await audit(actor, "RECURRENCE_UPDATED", existing, { fields: Object.keys(data) });
}

export async function setRecurrenceStatus(id: string, action: "PAUSE" | "RESUME" | "END", user: SessionUser, actor: Actor): Promise<void> {
  await assertRecurrenceAccess(user, id);
  const existing = await prisma.billingRecurrence.findUniqueOrThrow({ where: { id } });
  const transitions: Record<typeof action, { from: RecurrenceStatus[]; to: RecurrenceStatus; audit: AuditAction }> = {
    PAUSE: { from: ["ACTIVE"], to: "PAUSED", audit: "RECURRENCE_PAUSED" },
    RESUME: { from: ["PAUSED"], to: "ACTIVE", audit: "RECURRENCE_RESUMED" },
    END: { from: ["ACTIVE", "PAUSED"], to: "ENDED", audit: "RECURRENCE_ENDED" },
  };
  const t = transitions[action];
  if (!t.from.includes(existing.status)) throw new ConflictError("Esta ação não é possível no estado atual da recorrência.");
  const updated = await prisma.billingRecurrence.update({ where: { id }, data: { status: t.to } });
  if (action === "RESUME") await generateChargesForRecurrence(updated, await getBillingSettings(), new Date());
  await audit(actor, t.audit, existing);
}

export interface RecurrenceListItem {
  id: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  description: string;
  amountCents: number;
  period: string;
  dueDay: number | null;
  startDate: string;
  endDate: string | null;
  status: RecurrenceStatus;
  chargeCount: number;
}

export async function listRecurrences(user: SessionUser): Promise<RecurrenceListItem[]> {
  const scope = await getProjectScope(user);
  const rows = await prisma.billingRecurrence.findMany({
    where: recurrenceWhere(scope),
    include: { client: { select: { name: true, tradeName: true } }, project: { select: { name: true } }, _count: { select: { charges: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.tradeName ?? r.client.name,
    projectId: r.projectId,
    projectName: r.project?.name ?? null,
    description: r.description,
    amountCents: r.amountCents,
    period: r.period,
    dueDay: r.dueDay,
    startDate: dateToCivil(r.startDate),
    endDate: r.endDate ? dateToCivil(r.endDate) : null,
    status: r.status,
    chargeCount: r._count.charges,
  }));
}
