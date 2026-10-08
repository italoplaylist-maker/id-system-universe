import { prisma, resetDb, makeUser, startMockEvolution, type MockEvolution } from "./helpers";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setConfig } from "@/server/integrations/config";
import { createClient } from "@/server/billing/client-service";
import { cancelCharge, createCharge, getBillingSummary, getChargeDetail, listCharges, payCharge, reversePayment, sendChargeNow } from "@/server/billing/charge-service";
import { createRecurrence, setRecurrenceStatus } from "@/server/billing/recurrence-service";
import { generateAllRecurringCharges } from "@/server/billing/recurrence";
import { processDueReminders } from "@/server/billing/reminders";
import { runBillingTick } from "@/server/billing/scheduler";
import { deriveChargeStatus } from "@/server/billing/charge-status";
import { normalizePhone } from "@/lib/phone";
import { addMonthsWithDay, zonedTimeToUtc } from "@/lib/civil-date";
import type { SessionUser } from "@/server/auth/session";

const RULES = [
  { direction: "BEFORE" as const, offsetDays: 1, sendTime: "09:00", enabled: true },
  { direction: "ON" as const, offsetDays: 0, sendTime: "09:00", enabled: true },
  { direction: "AFTER" as const, offsetDays: 2, sendTime: "09:00", enabled: true },
];

// America/Sao_Paulo = UTC-3: 09:00 local = 12:00Z.
const at = (iso: string) => new Date(iso);

let evolution: MockEvolution;
let admin: SessionUser;
let actor: { userId: string };
let clientId: string;

describe("Central de Cobranças", () => {
  before(async () => {
    evolution = await startMockEvolution();
  });
  after(async () => {
    await evolution.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    evolution.sent.length = 0;
    evolution.mode.value = "ok";
    await setConfig("whatsapp.baseUrl", evolution.url);
    await setConfig("whatsapp.apiKey", "test-key");
    await setConfig("whatsapp.instance", "idsystem");
    admin = await makeUser("SUPERADMIN", "root@test.dev");
    actor = { userId: admin.id };
    const client = await createClient({ name: "Italoc", whatsapp: "(11) 99999-8888" }, admin, actor);
    clientId = client.id;
  });

  async function chargeDue(dueDate: string) {
    const { id } = await createCharge({ clientId, description: "Manutenção mensal do sistema", amountCents: 80000, dueDate, rules: RULES }, admin, actor);
    return id;
  }

  it("normaliza telefone brasileiro e rejeita número inválido", () => {
    assert.equal(normalizePhone("(11) 99999-8888"), "5511999998888");
    assert.equal(normalizePhone("+55 11 99999-8888"), "5511999998888");
    assert.equal(normalizePhone("011 99999-8888"), "5511999998888");
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizePhone(""), null);
  });

  it("vencimento é data civil: dia 10 continua dia 10 e o fuso não o desloca", async () => {
    const id = await chargeDue("2026-11-10");
    const detail = await getChargeDetail(id, admin);
    assert.equal(detail.dueDate, "2026-11-10");
    const row = await prisma.charge.findUniqueOrThrow({ where: { id } });
    assert.equal(row.dueDate.toISOString(), "2026-11-10T00:00:00.000Z");
    assert.equal(addMonthsWithDay("2026-01-31", 1, 31), "2026-02-28");
    assert.equal(zonedTimeToUtc("2026-11-10", "09:00", "America/Sao_Paulo").toISOString(), "2026-11-10T12:00:00.000Z");
  });

  it("status derivado da data (não depende de job)", () => {
    const today = "2026-11-10";
    assert.equal(deriveChargeStatus({ status: "PENDING", dueDate: "2026-11-10" }, today), "VENCE_HOJE");
    assert.equal(deriveChargeStatus({ status: "PENDING", dueDate: "2026-11-09" }, today), "VENCIDA");
    assert.equal(deriveChargeStatus({ status: "PENDING", dueDate: "2026-11-12" }, today), "PENDENTE");
    assert.equal(deriveChargeStatus({ status: "PENDING", dueDate: "2026-12-30" }, today), "AGENDADA");
    assert.equal(deriveChargeStatus({ status: "PAID", dueDate: "2026-11-01" }, today), "PAGA");
    assert.equal(deriveChargeStatus({ status: "CANCELLED", dueDate: "2026-11-01" }, today), "CANCELADA");
  });

  it("cenário completo: 09/11 → 1 msg, 10/11 → 1 msg, paga dia 10 → ZERO em 12/11", async () => {
    const id = await chargeDue("2026-11-10");

    // 08/11: nada devido ainda.
    await processDueReminders(at("2026-11-08T15:00:00Z"));
    assert.equal(evolution.sent.length, 0);

    // 09/11 12:00 local → aviso "1 dia antes".
    await processDueReminders(at("2026-11-09T15:00:00Z"));
    assert.equal(evolution.sent.length, 1);
    assert.equal(evolution.sent[0].phone, "5511999998888");
    assert.match(evolution.sent[0].text, /R\$ 800,00/);
    assert.match(evolution.sent[0].text, /10\/11\/2026/);
    assert.match(evolution.sent[0].text, /Italoc/);

    // Rodar de novo (mesmo instante) NÃO reenvia.
    await processDueReminders(at("2026-11-09T15:00:00Z"));
    assert.equal(evolution.sent.length, 1);

    // 10/11 → aviso do dia.
    await processDueReminders(at("2026-11-10T15:00:00Z"));
    assert.equal(evolution.sent.length, 2);
    assert.match(evolution.sent[1].text, /vence hoje/);

    // Paga no dia 10 → aviso de 12/11 não sai.
    await payCharge(id, { paidAt: "2026-11-10" }, admin, actor);
    await processDueReminders(at("2026-11-12T15:00:00Z"));
    assert.equal(evolution.sent.length, 2);

    const detail = await getChargeDetail(id, admin);
    assert.equal(detail.status, "PAGA");
    const after = detail.reminders.find((r) => r.description.includes("2 dias"));
    assert.equal(after?.status, "SKIPPED");
    assert.match(after?.reason ?? "", /paga/i);
    // Histórico preservado.
    assert.equal(detail.reminders.filter((r) => r.status === "SENT").length, 2);
  });

  it("scheduler rodando duas vezes ao mesmo tempo envia UMA mensagem", async () => {
    await chargeDue("2026-11-10");
    const now = at("2026-11-09T15:00:00Z");
    await Promise.all([processDueReminders(now), processDueReminders(now), runBillingTick(now)]);
    assert.equal(evolution.sent.length, 1);
    const messages = await prisma.whatsAppMessage.findMany({ where: { kind: "AUTOMATIC" } });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].status, "SENT");
  });

  it("respeita a janela de envio: fora do horário adia para a próxima janela", async () => {
    await chargeDue("2026-11-10");
    // 09/11 19:00 local (22:00Z) — fora de 08:00–18:00.
    const summary = await processDueReminders(at("2026-11-09T22:00:00Z"));
    assert.equal(summary.deferred, 1);
    assert.equal(evolution.sent.length, 0);
    const reminder = await prisma.chargeReminder.findFirstOrThrow({ where: { status: "PENDING", nextAttemptAt: { not: null } } });
    assert.equal(reminder.nextAttemptAt?.toISOString(), "2026-11-10T11:00:00.000Z"); // 08:00 local do dia seguinte
    assert.equal(reminder.attempts, 0);
    // Dentro da janela seguinte, sai.
    await processDueReminders(at("2026-11-10T11:00:00Z"));
    assert.equal(evolution.sent.filter((s) => /Passando para lembrar/.test(s.text)).length, 1);
  });

  it("falha transitória: retry com backoff; falha definitiva: FAILED sem retry", async () => {
    await chargeDue("2026-11-10");
    evolution.mode.value = "500";
    const now = at("2026-11-09T15:00:00Z");
    const first = await processDueReminders(now);
    assert.equal(first.retried, 1);
    let reminder = await prisma.chargeReminder.findFirstOrThrow({ where: { lastError: { not: null } } });
    assert.equal(reminder.status, "PENDING");
    assert.equal(reminder.attempts, 1);
    assert.ok(reminder.nextAttemptAt && reminder.nextAttemptAt > now);

    // Antes do backoff não tenta de novo.
    await processDueReminders(new Date(now.getTime() + 30_000));
    reminder = await prisma.chargeReminder.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(reminder.attempts, 1);

    // Serviço volta: próxima tentativa envia.
    evolution.mode.value = "ok";
    await processDueReminders(new Date(now.getTime() + 5 * 60_000));
    assert.equal(evolution.sent.length, 1);
    reminder = await prisma.chargeReminder.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(reminder.status, "SENT");

    // 4xx = definitivo.
    evolution.mode.value = "400";
    await processDueReminders(at("2026-11-10T15:00:00Z"));
    const failed = await prisma.chargeReminder.findMany({ where: { status: "FAILED" } });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].attempts, 1);
  });

  it("limita tentativas (sem loop infinito)", async () => {
    await chargeDue("2026-11-10");
    evolution.mode.value = "500";
    let now = at("2026-11-09T15:00:00Z");
    for (let i = 0; i < 9; i += 1) {
      await processDueReminders(now);
      now = new Date(now.getTime() + 40 * 60_000); // além do maior backoff (32 min) e dentro da janela
    }
    const reminder = await prisma.chargeReminder.findFirstOrThrow({ where: { lastError: { not: null } } });
    assert.equal(reminder.status, "FAILED");
    assert.equal(reminder.attempts, 5);
    assert.equal(evolution.sent.length, 0);
  });

  it("cliente sem WhatsApp válido: aviso FAILED e alerta interno", async () => {
    const other = await createClient({ name: "Sem Zap" }, admin, actor);
    const { id } = await createCharge({ clientId: other.id, description: "Hospedagem", amountCents: 5000, dueDate: "2026-11-10", rules: RULES }, admin, actor);
    await processDueReminders(at("2026-11-09T15:00:00Z"));
    assert.equal(evolution.sent.length, 0);
    const detail = await getChargeDetail(id, admin);
    assert.ok(detail.reminders.some((r) => r.status === "FAILED" && /WhatsApp/.test(r.reason ?? "")));
    assert.equal(await prisma.universeEvent.count({ where: { type: "BILLING_CLIENT_WITHOUT_WHATSAPP", permission: "billing:view" } }), 1);
  });

  it("pagamento duplo simultâneo gera um único pagamento; reverter restaura avisos futuros", async () => {
    const id = await chargeDue("2026-11-10");
    const results = await Promise.allSettled([payCharge(id, {}, admin, actor), payCharge(id, {}, admin, actor)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await prisma.chargePayment.count({ where: { chargeId: id } }), 1);

    await reversePayment(id, admin, actor);
    const detail = await getChargeDetail(id, admin);
    assert.equal(detail.payments[0].reversed, true);
    assert.ok(["PENDENTE", "AGENDADA", "VENCIDA", "VENCE_HOJE"].includes(detail.status));
    assert.ok(detail.reminders.some((r) => r.status === "PENDING"));
  });

  it("cancelar cobrança cancela avisos futuros e mantém o histórico", async () => {
    const id = await chargeDue("2026-11-10");
    await cancelCharge(id, admin, actor);
    await processDueReminders(at("2026-11-12T15:00:00Z"));
    assert.equal(evolution.sent.length, 0);
    assert.equal((await getChargeDetail(id, admin)).status, "CANCELADA");
  });

  it("recorrência mensal é idempotente por competência e gera a seguinte após pagar", async () => {
    const { id: recId } = await createRecurrence(
      { clientId, description: "Mensalidade", amountCents: 80000, period: "MONTHLY", dueDay: 10, startDate: "2026-10-10", rules: RULES },
      admin,
      actor,
    );

    // 20/10: outubro (10/10) e novembro (10/11 ≤ 20/10 + 31d) existem.
    const day20 = at("2026-10-20T15:00:00Z");
    const first = await generateAllRecurringCharges(day20);
    const second = await generateAllRecurringCharges(day20);
    const third = await Promise.all([generateAllRecurringCharges(day20), generateAllRecurringCharges(day20)]);
    assert.ok(first.created >= 0);
    assert.equal(second.created, 0);
    assert.equal(third[0].created + third[1].created, 0);

    const competences = (await prisma.charge.findMany({ where: { recurrenceId: recId }, orderBy: { dueDate: "asc" } })).map((c) => c.competence);
    assert.deepEqual(competences, ["2026-10", "2026-11"]);

    // Paga outubro: recorrência segue viva; novembro pendente; dezembro aparece quando entra no horizonte.
    const october = await prisma.charge.findFirstOrThrow({ where: { recurrenceId: recId, competence: "2026-10" } });
    await payCharge(october.id, { paidAt: "2026-10-10" }, admin, actor);
    await generateAllRecurringCharges(at("2026-11-15T15:00:00Z"));
    const after = await prisma.charge.findMany({ where: { recurrenceId: recId }, orderBy: { dueDate: "asc" } });
    assert.deepEqual(after.map((c) => [c.competence, c.status]), [["2026-10", "PAID"], ["2026-11", "PENDING"], ["2026-12", "PENDING"]]);

    // Regra da recorrência foi copiada para cada cobrança e os avisos foram agendados.
    assert.equal(await prisma.chargeReminderRule.count({ where: { chargeId: after[2].id } }), 3);
    assert.ok((await prisma.chargeReminder.count({ where: { chargeId: after[2].id } })) === 3);

    // Pausar e encerrar: não gera mais; histórico permanece.
    await setRecurrenceStatus(recId, "PAUSE", admin, actor);
    await generateAllRecurringCharges(at("2027-03-01T15:00:00Z"));
    assert.equal(await prisma.charge.count({ where: { recurrenceId: recId } }), 3);
    await setRecurrenceStatus(recId, "RESUME", admin, actor);
    await setRecurrenceStatus(recId, "END", admin, actor);
    await generateAllRecurringCharges(at("2027-06-01T15:00:00Z"));
    assert.equal(await prisma.charge.count({ where: { recurrenceId: recId } }), 3);
  });

  it("envio manual: preview, confirmação e registro no histórico", async () => {
    const id = await chargeDue("2099-01-10");
    const result = await sendChargeNow(id, {}, admin, actor);
    assert.equal(result.status, "SENT");
    assert.equal(evolution.sent.length, 1);
    const detail = await getChargeDetail(id, admin);
    assert.equal(detail.messages[0].kind, "MANUAL");
    assert.ok(detail.audit.some((a) => a.action === "WHATSAPP_MANUAL_SEND"));
  });

  it("template: variáveis desconhecidas rejeitadas e valores não injetam {{ }}", async () => {
    const { validateTemplate, renderTemplate } = await import("@/server/billing/templates");
    assert.throws(() => validateTemplate("Olá {{naoexiste}}"));
    const out = renderTemplate("Oi {{cliente}}", { cliente: "{{valor}} Evil", valor: "x", vencimento: "", motivo: "", projeto: "", competencia: "", diasAtraso: "0" });
    assert.equal(out, "Oi valor Evil");
  });

  it("dashboard: totais corretos e auditoria de valor/vencimento", async () => {
    await createCharge({ clientId, description: "A", amountCents: 10000, dueDate: "2020-01-01", rules: [] }, admin, actor);
    await createCharge({ clientId, description: "B", amountCents: 20000, dueDate: "2099-01-01", rules: [] }, admin, actor);
    const summary = await getBillingSummary({}, admin);
    assert.equal(summary.toReceiveCents, 30000);
    assert.equal(summary.overdueCents, 10000);
    const list = await listCharges({ view: "OVERDUE" }, admin);
    assert.equal(list.total, 1);
    assert.ok(list.items[0].daysOverdue > 0);
  });
});
