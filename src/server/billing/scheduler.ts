import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { civilToDate, todayInTimezone } from "@/lib/civil-date";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { generateAllRecurringCharges } from "@/server/billing/recurrence";
import { processDueReminders, type ProcessSummary } from "@/server/billing/reminders";
import { getBillingSettings } from "@/server/billing/settings";

/** Alertas internos agregados por Project, no máximo UM por tipo/projeto/dia. */
async function raiseDailyAlerts(now: Date): Promise<void> {
  const settings = await getBillingSettings();
  const today = todayInTimezone(settings.timezone, now);
  const todayDate = civilToDate(today);
  const dayStart = new Date(todayDate.getTime());

  const kinds = [
    { type: "BILLING_DUE_TODAY" as const, where: { status: "PENDING" as const, dueDate: todayDate }, text: (n: number) => `${n} cobrança(s) vencem hoje.` },
    { type: "BILLING_OVERDUE" as const, where: { status: "PENDING" as const, dueDate: { lt: todayDate } }, text: (n: number) => `${n} cobrança(s) vencida(s).` },
  ];
  for (const kind of kinds) {
    const groups = await prisma.charge.groupBy({ by: ["projectId"], where: kind.where, _count: true });
    for (const group of groups) {
      // Idempotente: já avisou hoje para este projeto? (janela = dia civil no fuso configurado, aproximado por 20h)
      const already = await prisma.universeEvent.findFirst({
        where: { type: kind.type, projectId: group.projectId, createdAt: { gte: new Date(Math.max(dayStart.getTime(), now.getTime() - 20 * 3600_000)) } },
        select: { id: true },
      });
      if (already) continue;
      await recordUniverseEvent({ type: kind.type, message: kind.text(group._count), permission: "billing:view", projectId: group.projectId });
    }
  }
}

export interface BillingTickResult {
  generated: { recurrences: number; created: number };
  reminders: ProcessSummary;
}

let running = false;

/**
 * O "relógio" das cobranças — roda no servidor (instrumentation), nunca no
 * navegador. `now` é injetável para testar sem esperar o calendário.
 */
export async function runBillingTick(now: Date = new Date()): Promise<BillingTickResult | null> {
  if (running) return null;
  running = true;
  try {
    const generated = await generateAllRecurringCharges(now);
    const reminders = await processDueReminders(now);
    await raiseDailyAlerts(now).catch((error) => logger.warn("billing_alerts_failed", { message: error instanceof Error ? error.message : String(error) }));
    return { generated, reminders };
  } finally {
    running = false;
  }
}
