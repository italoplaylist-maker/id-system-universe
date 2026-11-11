import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMERCIAL_ALLOWED_TOOLS, COMMERCIAL_DISALLOWED_TOOLS, COMMERCIAL_ROUTINES, COMMERCIAL_RULES, COMMERCIAL_TEAM, COMMERCIAL_TOOLS_BY_SLUG, CYCLE_STEPS,
  cycleKey, funnelMetrics, isStale, leadKeys, nextCycleStep, operatingCost, parseCycleKey, siteDomain, commercialRoleNote,
} from "../src/lib/commercial-team";
import { CLT_TEAM } from "../src/lib/clt-team";

test("a equipe tem 4 funcionários reais com tudo definido e nenhum slug repetido da equipe CLT", () => {
  assert.deepEqual(COMMERCIAL_TEAM.map((a) => a.name), ["Garimpeiro", "Analista Comercial", "CRM", "Vendedor"]);
  const cltSlugs = new Set(CLT_TEAM.map((a) => a.slug as string));
  for (const a of COMMERCIAL_TEAM) {
    assert.ok(!cltSlugs.has(a.slug));
    assert.ok(a.description.length > 300 && a.dailyTokenLimit > 0 && a.monthlyTokenLimit >= a.dailyTokenLimit);
    assert.ok(COMMERCIAL_TOOLS_BY_SLUG[a.slug].length > 0, "sem ferramenta = agente fictício");
  }
});

test("separação de poderes: só pesquisa na web; sem shell, edição, Git, merge ou delegação técnica", () => {
  assert.deepEqual(COMMERCIAL_ALLOWED_TOOLS, ["WebSearch", "WebFetch"]);
  for (const t of ["Bash", "Edit", "Write", "mcp__universe__publish_changes", "mcp__universe__merge_pull_request", "mcp__universe__delegar_tarefa"]) assert.ok(COMMERCIAL_DISALLOWED_TOOLS.includes(t), t);
  for (const t of COMMERCIAL_ALLOWED_TOOLS) assert.ok(!COMMERCIAL_DISALLOWED_TOOLS.includes(t));
  // nenhuma ferramenta comercial tem nome de envio
  for (const list of Object.values(COMMERCIAL_TOOLS_BY_SLUG)) for (const n of list) assert.ok(!/enviar|disparar|send/i.test(n), n);
  assert.match(COMMERCIAL_RULES.join(" "), /NUNCA envie mensagem/);
  assert.match(COMMERCIAL_RULES.join(" "), /dados pessoais/);
  assert.match(commercialRoleNote({ name: "CRM", roleTitle: "Funil", description: "x" }), /COMERCIAL & MARKETING/);
});

test("duplicatas: o mesmo site, telefone ou nome+cidade é a mesma empresa", () => {
  assert.equal(siteDomain("https://www.Padaria.com.br/contato"), "padaria.com.br");
  assert.equal(siteDomain("sem-ponto"), null);
  const a = leadKeys({ name: "Padaria do Zé", city: "Itatiaiuçu", phone: "(31) 99999-1234", website: "www.padariaze.com.br" });
  const b = leadKeys({ name: "PADARIA DO ZE LTDA", city: "Itatiaiucu", phone: "+55 31 99999 1234" });
  assert.ok(a.some((k) => b.includes(k)), "telefone igual");
  const c = leadKeys({ name: "Outra", website: "https://padariaze.com.br" });
  assert.ok(a.some((k) => c.includes(k)), "site igual");
  const d = leadKeys({ name: "Padaria do Zé", city: "itatiaiuçu" });
  assert.ok(a.some((k) => d.includes(k)), "nome+cidade igual sem acento/caixa");
  assert.ok(!leadKeys({ name: "Bar do João", website: "https://instagram.com/bardojoao" }).some((k) => k.startsWith("site:")), "rede social não identifica empresa");
});

test("indicadores: conversão sobre leads aproveitáveis; sem lead = sem taxa; custo só com preço configurado", () => {
  assert.equal(funnelMetrics({ total: 0, discarded: 0, qualified: 0, open: 0, pendingApproaches: 0, converted: 0 }).conversionRate, null);
  assert.equal(funnelMetrics({ total: 12, discarded: 2, qualified: 5, open: 7, pendingApproaches: 2, converted: 1 }).conversionRate, 10);
  assert.equal(operatingCost(2_000_000, null), null);
  assert.equal(operatingCost(2_000_000, 3), 6);
  const now = new Date("2026-11-20T12:00:00Z");
  assert.equal(isStale({ stage: "QUALIFICADO", updatedAt: new Date("2026-11-10T12:00:00Z"), lastContactAt: null }, now), true);
  assert.equal(isStale({ stage: "QUALIFICADO", updatedAt: new Date("2026-11-10T12:00:00Z"), lastContactAt: new Date("2026-11-19T12:00:00Z") }, now), false);
  assert.equal(isStale({ stage: "CONVERTIDO", updatedAt: new Date("2026-01-01T12:00:00Z"), lastContactAt: null }, now), false, "fechado não fica parado");
});

test("rotinas nascem desligadas e o ciclo coordenado tem 4 passos em ordem, sem loop e parando na falha", () => {
  assert.ok(COMMERCIAL_ROUTINES.every((r) => r.enabled === false));
  assert.ok(COMMERCIAL_ROUTINES.every((r) => COMMERCIAL_TEAM.some((a) => a.slug === r.slug)));
  assert.deepEqual(CYCLE_STEPS.map((s) => s.slug), ["id-garimpeiro", "id-analista", "id-crm", "id-vendedor"]);
  assert.equal(nextCycleStep(0, "COMPLETED"), 1);
  assert.equal(nextCycleStep(3, "COMPLETED"), null, "último passo: o ciclo acaba");
  assert.equal(nextCycleStep(1, "FAILED"), null, "falhou: para");
  assert.equal(nextCycleStep(1, "CANCELLED"), null);
  assert.deepEqual(parseCycleKey(cycleKey("abc123", 2)), { cycleId: "abc123", step: 2 });
  assert.equal(parseCycleKey("routine:x:1"), null);
});
