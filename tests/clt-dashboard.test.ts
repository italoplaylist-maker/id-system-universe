import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DELEGATIONS_PER_DAY, MAX_DELEGATIONS_PER_RUN, axisTicks, bucketByDay, checkDelegation, dayKey, dayLabel, lastDays, niceMax, resolveAgentRef } from "../src/lib/clt-dashboard";

const now = new Date("2026-11-10T15:00:00Z"); // 12:00 em São Paulo

test("janela de dias no fuso de São Paulo, em ordem crescente", () => {
  assert.deepEqual(lastDays(3, now), ["2026-11-08", "2026-11-09", "2026-11-10"]);
  assert.equal(lastDays(14, now).length, 14);
  // 01:00 UTC ainda é o dia anterior em São Paulo
  assert.equal(dayKey(new Date("2026-11-10T01:00:00Z")), "2026-11-09");
  assert.equal(dayLabel("2026-11-09"), "09/11");
});

test("soma por dia: ignora fora da janela e sem data", () => {
  const days = lastDays(3, now);
  const out = bucketByDay(
    [
      { at: new Date("2026-11-10T14:00:00Z"), value: 100 },
      { at: new Date("2026-11-10T03:30:00Z"), value: 50 },
      { at: new Date("2026-11-09T12:00:00Z"), value: 7 },
      { at: new Date("2026-10-01T12:00:00Z"), value: 999 },
      { at: null, value: 999 },
    ],
    days,
  );
  assert.deepEqual(out, [0, 7, 150]);
});

test("eixo: topo redondo (1/2/5 × 10^k) e marcas uniformes", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(1234), 2000);
  assert.equal(niceMax(3_400_000), 5_000_000);
  assert.deepEqual(axisTicks(1234, 4), [0, 500, 1000, 1500, 2000]);
});

const ok = { selfSlug: "id-manager", target: { slug: "id-doctor", paused: false, archived: false }, duplicateOpen: false, delegatedThisRun: 0, delegatedToday: 0, budgetReason: null };

test("delegação: só passa quando todas as travas permitem, e a primeira violada vira o motivo", () => {
  assert.deepEqual(checkDelegation(ok), { ok: true });
  const no = (patch: object) => checkDelegation({ ...ok, ...patch }) as { ok: false; reason: string };
  assert.match(no({ target: { slug: "id-manager", paused: false, archived: false } }).reason, /para si mesmo/);
  assert.match(no({ target: { slug: "id-doctor", paused: true, archived: false } }).reason, /pausado/);
  assert.match(no({ target: { slug: "id-doctor", paused: false, archived: true } }).reason, /removido/);
  assert.match(no({ delegatedThisRun: MAX_DELEGATIONS_PER_RUN }).reason, /por execução/);
  assert.match(no({ delegatedToday: MAX_DELEGATIONS_PER_DAY }).reason, /por dia/);
  assert.match(no({ duplicateOpen: true }).reason, /igual/);
  assert.match(no({ budgetReason: "Limite diário de tokens esgotado." }).reason, /orçamento/);
  assert.equal(checkDelegation({ ...ok, delegatedThisRun: MAX_DELEGATIONS_PER_RUN - 1 }).ok, true, "a última dentro do teto passa");
});

test("agente por slug, nome ou parte do nome; ambíguo e inexistente", () => {
  const team = [
    { id: "1", name: "ID Doctor", slug: "id-doctor" },
    { id: "2", name: "ID DevOps", slug: "id-devops" },
    { id: "3", name: "ID QA", slug: "id-qa" },
  ];
  assert.deepEqual(resolveAgentRef("id-doctor", team), team[0]);
  assert.deepEqual(resolveAgentRef("ID DevOps", team), team[1]);
  assert.deepEqual(resolveAgentRef("qa", team), team[2]);
  assert.deepEqual(resolveAgentRef("id", team), { ambiguous: ["ID Doctor", "ID DevOps", "ID QA"] });
  assert.equal(resolveAgentRef("segurança", team), null);
  assert.equal(resolveAgentRef("  ", team), null);
});
