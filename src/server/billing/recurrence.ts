import { Prisma, type BillingRecurrence, type RecurrencePeriod } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { addDays, addMonthsWithDay, civilToDate, dateToCivil, todayInTimezone, type CivilDate } from "@/lib/civil-date";
import { getBillingSettings, type BillingSettings } from "@/server/billing/settings";
import { materializeReminders } from "@/server/billing/reminders";
import { recordUniverseEvent } from "@/server/events/universe-events";

/** Quantos dias à frente a próxima competência já existe como cobrança AGENDADA. */
export const GENERATE_AHEAD_DAYS = 31;
const MAX_OCCURRENCES_PER_RUN = 60;

const MONTH_STEP: Partial<Record<RecurrencePeriod, number>> = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

export interface Occurrence {
  dueDate: CivilDate;
  /** Chave de idempotência da competência. */
  competence: string;
}

export function occurrencesUpTo(
  recurrence: { period: RecurrencePeriod; intervalDays: number | null; dueDay: number | null; startDate: CivilDate; endDate: CivilDate | null },
  upTo: CivilDate,
  cap = MAX_OCCURRENCES_PER_RUN,
): Occurrence[] {
  const result: Occurrence[] = [];
  const limit = recurrence.endDate && recurrence.endDate < upTo ? recurrence.endDate : upTo;
  const monthStep = MONTH_STEP[recurrence.period];

  if (monthStep) {
    const day = recurrence.dueDay ?? Number(recurrence.startDate.slice(8, 10));
    for (let k = 0; result.length < cap && k < 2400; k += 1) {
      const due = addMonthsWithDay(recurrence.startDate, k * monthStep, day);
      if (due < recurrence.startDate) continue; // dia-alvo anterior ao início no primeiro mês
      if (due > limit) break;
      result.push({ dueDate: due, competence: due.slice(0, 7) });
    }
    return result;
  }

  const step = recurrence.period === "WEEKLY" ? 7 : Math.max(1, recurrence.intervalDays ?? 30);
  for (let due = recurrence.startDate; result.length < cap && due <= limit; due = addDays(due, step)) {
    result.push({ dueDate: due, competence: due });
  }
  return result;
}

type RecurrenceRow = BillingRecurrence;

function toCivilFields(row: RecurrenceRow) {
  return {
    period: row.period,
    intervalDays: row.intervalDays,
    dueDay: row.dueDay,
    startDate: dateToCivil(row.startDate),
    endDate: row.endDate ? dateToCivil(row.endDate) : null,
  };
}

/**
 * Gera as cobranças que faltam de UMA recorrência. Idempotente em dois níveis:
 * checagem prévia + UNIQUE(recurrenceId, competence) no banco (corrida entre
 * processos vira P2002 e é ignorada) — duas execuções nunca duplicam a competência.
 */
export async function generateChargesForRecurrence(recurrence: RecurrenceRow, settings: BillingSettings, now: Date): Promise<number> {
  if (recurrence.status !== "ACTIVE") return 0;
  const today = todayInTimezone(settings.timezone, now);
  const occurrences = occurrencesUpTo(toCivilFields(recurrence), addDays(today, GENERATE_AHEAD_DAYS));
  if (occurrences.length === 0) return 0;

  const existing = await prisma.charge.findMany({ where: { recurrenceId: recurrence.id, competence: { in: occurrences.map((o) => o.competence) } }, select: { competence: true } });
  const have = new Set(existing.map((e) => e.competence));
  const templateRules = await prisma.chargeReminderRule.findMany({ where: { recurrenceId: recurrence.id } });

  let created = 0;
  for (const occurrence of occurrences) {
    if (have.has(occurrence.competence)) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const charge = await tx.charge.create({
          data: {
            clientId: recurrence.clientId,
            projectId: recurrence.projectId,
            recurrenceId: recurrence.id,
            reasonId: recurrence.reasonId,
            description: recurrence.description,
            amountCents: recurrence.amountCents,
            dueDate: civilToDate(occurrence.dueDate),
            competence: occurrence.competence,
            whatsappEnabled: recurrence.whatsappEnabled,
            notes: recurrence.notes,
            createdByUserId: recurrence.createdByUserId,
          },
        });
        if (templateRules.length > 0) {
          await tx.chargeReminderRule.createMany({
            data: templateRules.map((r) => ({ chargeId: charge.id, direction: r.direction, offsetDays: r.offsetDays, sendTime: r.sendTime, template: r.template, enabled: r.enabled })),
          });
          await materializeReminders(tx, charge.id, occurrence.dueDate, settings);
        }
      });
      created += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue; // outro processo gerou
      logger.error("recurrence_generation_failed", { recurrenceId: recurrence.id, competence: occurrence.competence, message: error instanceof Error ? error.message : String(error) });
      await recordUniverseEvent({ type: "BILLING_RECURRENCE_ERROR", message: "Erro ao gerar cobrança recorrente.", permission: "billing:view", projectId: recurrence.projectId });
      break;
    }
  }
  return created;
}

export async function generateAllRecurringCharges(now: Date = new Date()): Promise<{ recurrences: number; created: number }> {
  const settings = await getBillingSettings();
  const recurrences = await prisma.billingRecurrence.findMany({ where: { status: "ACTIVE" } });
  let created = 0;
  for (const recurrence of recurrences) created += await generateChargesForRecurrence(recurrence, settings, now);
  return { recurrences: recurrences.length, created };
}
