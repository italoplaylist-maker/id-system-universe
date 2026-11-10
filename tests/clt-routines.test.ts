import { test } from "node:test";
import assert from "node:assert/strict";
import { CATCH_UP_MINUTES, CLT_ROUTINES, ROUTINE_GATES, describeSchedule, dueSlot, isValidTime, localParts } from "../src/lib/clt-routines";
import { CLT_TEAM } from "../src/lib/clt-team";

// São Paulo é UTC−3 o ano todo (sem horário de verão desde 2019). 2026-11-10 é uma terça-feira.
const at = (utc: string) => new Date(utc);

test("fuso de São Paulo: data, dia da semana e minutos", () => {
  const p = localParts(at("2026-11-10T06:05:00Z"));
  assert.deepEqual(p, { date: "2026-11-10", weekday: 2, minutes: 3 * 60 + 5 });
  // 01:00 UTC ainda é "ontem" em São Paulo (22:00 do dia anterior)
  const q = localParts(at("2026-11-10T01:00:00Z"));
  assert.equal(q.date, "2026-11-09");
  assert.equal(q.weekday, 1);
  assert.equal(q.minutes, 22 * 60);
});

test("dueSlot: só no dia marcado, a partir do horário e dentro da janela de recuperação", () => {
  const tue3 = { days: [2], time: "03:00" };
  assert.equal(dueSlot(tue3, at("2026-11-10T06:00:00Z")), "2026-11-10 03:00");
  assert.equal(dueSlot(tue3, at("2026-11-10T06:30:00Z")), "2026-11-10 03:00", "servidor voltou 30 min depois: ainda dispara");
  assert.equal(dueSlot(tue3, at("2026-11-10T05:59:00Z")), null, "antes do horário");
  assert.equal(dueSlot(tue3, at(`2026-11-10T0${6 + Math.floor(CATCH_UP_MINUTES / 60)}:${String(CATCH_UP_MINUTES % 60).padStart(2, "0")}:00Z`)), null, "passou da janela: não dispara de madrugada fora de hora");
  assert.equal(dueSlot({ days: [3], time: "03:00" }, at("2026-11-10T06:00:00Z")), null, "dia errado");
  assert.equal(dueSlot({ days: [2], time: "25:00" }, at("2026-11-10T06:00:00Z")), null, "horário inválido");
});

test("validação de horário e descrição legível", () => {
  assert.ok(isValidTime("00:00") && isValidTime("23:59") && isValidTime("07:30"));
  assert.ok(!isValidTime("24:00") && !isValidTime("7:30") && !isValidTime("07:60") && !isValidTime(""));
  assert.equal(describeSchedule({ days: [0, 1, 2, 3, 4, 5, 6], time: "07:00" }), "Todos os dias às 07:00");
  assert.equal(describeSchedule({ days: [5, 4, 3, 2, 1], time: "03:00" }), "Seg a Sex às 03:00");
  assert.equal(describeSchedule({ days: [0], time: "03:00" }), "Dom às 03:00");
  assert.equal(describeSchedule({ days: [1, 3], time: "18:00" }), "Seg, Qua às 18:00");
});

test("rotinas padrão: cada uma pertence a um agente da equipe, com horário e gatilho válidos, sem repetir", () => {
  const slugs = new Set(CLT_TEAM.map((a) => a.slug));
  const gates = new Set(ROUTINE_GATES.map((g) => g.id));
  const seen = new Set<string>();
  for (const r of CLT_ROUTINES) {
    assert.ok(slugs.has(r.slug), `${r.name}: agente inexistente`);
    assert.ok(isValidTime(r.time), `${r.name}: horário inválido`);
    assert.ok(gates.has(r.gate), `${r.name}: gatilho inválido`);
    assert.ok(r.days.length > 0 && r.days.every((d) => d >= 0 && d <= 6), `${r.name}: dias inválidos`);
    assert.ok([-1, 0, 1].includes(r.priority), `${r.name}: prioridade inválida`);
    assert.ok(r.prompt.length > 80, `${r.name}: instrução curta demais`);
    assert.match(r.prompt, /econômico/, `${r.name}: sem a instrução de economia de tokens`);
    const key = `${r.slug}|${r.name}`;
    assert.ok(!seen.has(key), `${r.name}: duplicada`);
    seen.add(key);
  }
  // cada um dos 7 funcionários tem pelo menos uma rotina
  for (const a of CLT_TEAM) assert.ok(CLT_ROUTINES.some((r) => r.slug === a.slug), `${a.name} sem rotina`);
});

test("rotinas padrão não são ações de risco: nada de deploy, merge ou apagar sem aprovação, e só de madrugada/manhã cedo ou fim do dia", () => {
  for (const r of CLT_ROUTINES) {
    // toda menção a ação de risco precisa vir com a proibição / pedido de aprovação
    if (/\b(reinicie|remova|apague|aplique|faça (o )?deploy|faça merge)\b/i.test(r.prompt)) assert.match(r.prompt, /NÃO|Não |sem fazer merge|sem aprovação|peça aprovação/, `${r.name}: cita ação de risco sem proibi-la`);
    const hour = Number(r.time.slice(0, 2));
    assert.ok(hour <= 8 || hour >= 18, `${r.name}: horário em plena jornada (${r.time})`);
  }
  // o gerente resume DEPOIS dos outros terem rodado (e só se alguém trabalhou)
  const manager = CLT_ROUTINES.find((r) => r.slug === "id-manager")!;
  assert.equal(manager.gate, "activity");
  assert.ok(CLT_ROUTINES.filter((r) => r.slug !== "id-manager" && r.time < "08:00").every((r) => r.time < manager.time));
});
