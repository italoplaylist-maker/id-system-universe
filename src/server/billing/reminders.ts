import { Prisma, type ChargeReminderRule, type ReminderDirection } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { addDays, dateToCivil, minutesOfDayInTimezone, parseHHmm, todayInTimezone, zonedTimeToUtc, type CivilDate } from "@/lib/civil-date";
import type { ReminderRuleInput } from "@/lib/billing-defaults";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { getBillingSettings, type BillingSettings } from "@/server/billing/settings";
import { buildVariables, getTemplates, renderTemplate } from "@/server/billing/templates";
import { daysOverdue } from "@/server/billing/charge-status";
import { getWhatsAppProvider, WhatsAppSendError } from "@/server/whatsapp/whatsapp-provider";

const MAX_ATTEMPTS = 5;
const LOCK_LEASE_MS = 10 * 60 * 1000;
/** Aviso muito atrasado (ex.: servidor ficou fora do ar) não é disparado fora de hora. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

export function scheduledInstant(dueDate: CivilDate, rule: Pick<ChargeReminderRule, "direction" | "offsetDays" | "sendTime">, timezone: string): Date {
  const offset = rule.direction === "BEFORE" ? -rule.offsetDays : rule.direction === "AFTER" ? rule.offsetDays : 0;
  return zonedTimeToUtc(addDays(dueDate, offset), rule.sendTime, timezone);
}

export function validateRuleInputs(rules: ReminderRuleInput[]): void {
  for (const rule of rules) {
    if (parseHHmm(rule.sendTime) === null) throw new Error(`Horário inválido: ${rule.sendTime}`);
    if (!Number.isInteger(rule.offsetDays) || rule.offsetDays < 0 || rule.offsetDays > 365) throw new Error("Dias do aviso inválidos.");
    if (rule.direction === "ON" && rule.offsetDays !== 0) throw new Error("Aviso no vencimento não tem deslocamento.");
    if (rule.direction !== "ON" && rule.offsetDays === 0) throw new Error("Avisos antes/depois precisam de ao menos 1 dia.");
  }
}

type Tx = Prisma.TransactionClient;

/** Cria os avisos (idempotente: unique chargeId+ruleId+scheduledAt) das regras habilitadas da cobrança. */
export async function materializeReminders(tx: Tx, chargeId: string, dueDate: CivilDate, settings: BillingSettings): Promise<number> {
  const rules = await tx.chargeReminderRule.findMany({ where: { chargeId, enabled: true } });
  if (rules.length === 0) return 0;
  const result = await tx.chargeReminder.createMany({
    data: rules.map((rule) => ({ chargeId, ruleId: rule.id, scheduledAt: scheduledInstant(dueDate, rule, settings.timezone) })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function skipPendingReminders(tx: Tx, chargeId: string, reason: string): Promise<number> {
  const result = await tx.chargeReminder.updateMany({ where: { chargeId, status: "PENDING" }, data: { status: "SKIPPED", skippedReason: reason } });
  return result.count;
}

/** Substitui a régua da cobrança preservando o histórico de avisos já enviados. */
export async function replaceChargeRules(tx: Tx, chargeId: string, rules: ReminderRuleInput[]): Promise<void> {
  const existing = await tx.chargeReminderRule.findMany({ where: { chargeId }, include: { _count: { select: { reminders: { where: { status: { in: ["SENT", "FAILED", "PROCESSING"] } } } } } } });
  const key = (r: { direction: ReminderDirection; offsetDays: number; sendTime: string }) => `${r.direction}:${r.offsetDays}:${r.sendTime}`;
  const wanted = new Map(rules.map((r) => [key(r), r]));

  for (const row of existing) {
    const match = wanted.get(key(row));
    if (match) {
      await tx.chargeReminderRule.update({ where: { id: row.id }, data: { enabled: match.enabled, template: match.template ?? null } });
      wanted.delete(key(row));
      if (!match.enabled) await tx.chargeReminder.updateMany({ where: { ruleId: row.id, status: "PENDING" }, data: { status: "SKIPPED", skippedReason: "Regra desativada." } });
    } else if (row._count.reminders > 0) {
      await tx.chargeReminderRule.update({ where: { id: row.id }, data: { enabled: false } });
      await tx.chargeReminder.updateMany({ where: { ruleId: row.id, status: "PENDING" }, data: { status: "SKIPPED", skippedReason: "Regra removida." } });
    } else {
      await tx.chargeReminderRule.delete({ where: { id: row.id } });
    }
  }
  for (const rule of wanted.values()) {
    await tx.chargeReminderRule.create({
      data: { chargeId, direction: rule.direction, offsetDays: rule.offsetDays, sendTime: rule.sendTime, template: rule.template ?? null, enabled: rule.enabled },
    });
  }
}

/** Regenera os avisos PENDENTES quando a data muda (os já enviados ficam como histórico). */
export async function rescheduleReminders(tx: Tx, chargeId: string, dueDate: CivilDate, settings: BillingSettings): Promise<void> {
  await tx.chargeReminder.deleteMany({ where: { chargeId, status: "PENDING" } });
  await materializeReminders(tx, chargeId, dueDate, settings);
}

export type ProcessSummary = { processed: number; sent: number; skipped: number; failed: number; deferred: number; retried: number };

function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** attempt, 60 * 60 * 1000);
}

function nextWindowStart(now: Date, settings: BillingSettings): Date {
  const startMinutes = parseHHmm(settings.windowStart) ?? 8 * 60;
  const nowMinutes = minutesOfDayInTimezone(settings.timezone, now);
  const today = todayInTimezone(settings.timezone, now);
  // Antes da abertura: hoje; depois do fechamento: amanhã.
  const day = nowMinutes < startMinutes ? today : addDays(today, 1);
  return zonedTimeToUtc(day, settings.windowStart, settings.timezone);
}

export function isInsideSendWindow(now: Date, settings: BillingSettings): boolean {
  const minutes = minutesOfDayInTimezone(settings.timezone, now);
  const start = parseHHmm(settings.windowStart) ?? 8 * 60;
  const end = parseHHmm(settings.windowEnd) ?? 18 * 60;
  return minutes >= start && minutes < end;
}

/**
 * Processa avisos vencidos. Seguro para rodar em paralelo e repetidamente:
 * cada aviso é reivindicado com um UPDATE condicional (PENDING→PROCESSING),
 * então só UM executor chega a enviar — e um SENT nunca é elegível de novo.
 */
export async function processDueReminders(now: Date = new Date()): Promise<ProcessSummary> {
  const summary: ProcessSummary = { processed: 0, sent: 0, skipped: 0, failed: 0, deferred: 0, retried: 0 };
  const settings = await getBillingSettings();

  // Envio que travou no meio (processo morreu): o resultado é desconhecido — NÃO reenvia (evita cobrança duplicada).
  await prisma.chargeReminder.updateMany({
    where: { status: "PROCESSING", lockedAt: { lt: new Date(now.getTime() - LOCK_LEASE_MS) } },
    data: { status: "FAILED", lastError: "Resultado do envio desconhecido (processo interrompido). Verifique no WhatsApp antes de reenviar." },
  });

  const due = await prisma.chargeReminder.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });

  const templates = await getTemplates();

  for (const { id } of due) {
    const claimed = await prisma.chargeReminder.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PROCESSING", lockedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // outro executor pegou
    summary.processed += 1;

    const reminder = await prisma.chargeReminder.findUniqueOrThrow({
      where: { id },
      include: { rule: true, charge: { include: { client: true, project: { select: { name: true } } } } },
    });
    const { charge, rule } = reminder;
    const skip = async (reason: string) => {
      await prisma.chargeReminder.update({ where: { id }, data: { status: "SKIPPED", skippedReason: reason, lockedAt: null } });
      summary.skipped += 1;
    };

    if (charge.status === "PAID") { await skip("Cobrança já paga."); continue; }
    if (charge.status === "CANCELLED") { await skip("Cobrança cancelada."); continue; }
    if (!rule.enabled) { await skip("Regra desativada."); continue; }
    if (!charge.whatsappEnabled) { await skip("Envio por WhatsApp desativado nesta cobrança."); continue; }
    if (now.getTime() - reminder.scheduledAt.getTime() > STALE_AFTER_MS) { await skip("Aviso expirado (fora da janela de envio por muito tempo)."); continue; }

    if (!isInsideSendWindow(now, settings)) {
      await prisma.chargeReminder.update({
        where: { id },
        data: { status: "PENDING", lockedAt: null, nextAttemptAt: nextWindowStart(now, settings), attempts: { decrement: 1 } },
      });
      summary.deferred += 1;
      continue;
    }

    const phone = normalizePhone(charge.client.whatsapp);
    if (!phone) {
      await prisma.chargeReminder.update({ where: { id }, data: { status: "FAILED", lockedAt: null, lastError: "Cliente sem WhatsApp válido." } });
      await recordUniverseEvent({
        type: "BILLING_CLIENT_WITHOUT_WHATSAPP",
        message: `Cliente ${charge.client.name} está sem WhatsApp válido para receber cobranças.`,
        permission: "billing:view",
        projectId: charge.projectId,
      });
      summary.failed += 1;
      continue;
    }

    const dueDate = dateToCivil(charge.dueDate);
    const today = todayInTimezone(settings.timezone, now);
    const body = renderTemplate(
      rule.template ?? templates[rule.direction],
      buildVariables({
        clientName: charge.client.tradeName ?? charge.client.name,
        amountCents: charge.amountCents,
        dueDate,
        description: charge.description,
        projectName: charge.project?.name,
        competence: charge.competence,
        overdueDays: daysOverdue(dueDate, today),
      }),
    );

    // Última checagem imediatamente antes de enviar: pagamento pode ter ocorrido durante o processamento.
    const fresh = await prisma.charge.findUnique({ where: { id: charge.id }, select: { status: true } });
    if (fresh?.status !== "PENDING") { await skip(fresh?.status === "PAID" ? "Cobrança já paga." : "Cobrança cancelada."); continue; }

    const message = await prisma.whatsAppMessage.create({
      data: { clientId: charge.clientId, chargeId: charge.id, reminderId: id, kind: "AUTOMATIC", toPhone: phone, body, status: "PROCESSING" },
    });

    try {
      const provider = await getWhatsAppProvider();
      const result = await provider.sendText(phone, body);
      await prisma.$transaction([
        prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId } }),
        prisma.chargeReminder.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), lockedAt: null, lastError: null } }),
      ]);
      await recordAuditEvent({ action: "WHATSAPP_MESSAGE_SENT", status: "SUCCESS", entityType: "Charge", entityId: charge.id, projectId: charge.projectId, metadata: { reminderId: id, rule: `${rule.direction}:${rule.offsetDays}` } });
      summary.sent += 1;
    } catch (error) {
      const retryable = error instanceof WhatsAppSendError ? error.retryable : true;
      const errorMessage = error instanceof Error ? error.message : "Falha desconhecida no envio.";
      await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: "FAILED", error: errorMessage.slice(0, 500) } });
      const attempts = reminder.attempts;
      if (retryable && attempts < MAX_ATTEMPTS) {
        await prisma.chargeReminder.update({ where: { id }, data: { status: "PENDING", lockedAt: null, lastError: errorMessage.slice(0, 500), nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) } });
        summary.retried += 1;
      } else {
        await prisma.chargeReminder.update({ where: { id }, data: { status: "FAILED", lockedAt: null, lastError: errorMessage.slice(0, 500) } });
        await recordUniverseEvent({ type: "WHATSAPP_FAILED", message: `Falha ao enviar aviso de cobrança para ${charge.client.name}.`, permission: "billing:view", projectId: charge.projectId });
        await recordAuditEvent({ action: "WHATSAPP_MESSAGE_FAILED", status: "FAILED", entityType: "Charge", entityId: charge.id, projectId: charge.projectId, metadata: { reminderId: id, error: errorMessage.slice(0, 200) } });
        summary.failed += 1;
      }
      logger.warn("billing_reminder_send_failed", { reminderId: id, retryable, attempts });
    }
  }
  return summary;
}
