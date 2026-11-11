import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFindingBrief, buildFixBrief, findingKey, fixIdempotencyKey, fixState, parseItemId } from "../src/lib/fix-queue";

const t = (h: number) => new Date(Date.UTC(2026, 10, 11, h));

test("estado do item: pendente, corrigindo, enviado, descartado — e reabre se o erro volta", () => {
  assert.equal(fixState({ lastSeenAt: t(5), fixSentAt: null, dismissedAt: null, taskActive: false }), "pending");
  assert.equal(fixState({ lastSeenAt: t(5), fixSentAt: t(6), dismissedAt: null, taskActive: true }), "fixing");
  assert.equal(fixState({ lastSeenAt: t(5), fixSentAt: t(6), dismissedAt: null, taskActive: false }), "sent");
  assert.equal(fixState({ lastSeenAt: t(5), fixSentAt: null, dismissedAt: t(6), taskActive: false }), "dismissed");
  assert.equal(fixState({ lastSeenAt: t(8), fixSentAt: t(6), dismissedAt: null, taskActive: false }), "pending", "erro voltou depois do envio");
  assert.equal(fixState({ lastSeenAt: t(8), fixSentAt: null, dismissedAt: t(6), taskActive: false }), "pending", "erro voltou depois do descarte");
});

test("o pedido ao Manager traz o erro, manda delegar, proíbe merge e a chave é única por envio", () => {
  const b = buildFixBrief({ application: "api", project: "Padaria", count: 3, firstSeenAt: "a", lastSeenAt: "b", sample: "TypeError: x" });
  assert.match(b, /Padaria \/ api/);
  assert.match(b, /TypeError: x/);
  assert.match(b, /delegar_tarefa/);
  assert.match(b, /não faça merge/);
  assert.notEqual(fixIdempotencyKey("g", t(1)), fixIdempotencyKey("g", t(2)));
  assert.ok(fixIdempotencyKey("g", t(1)).startsWith("fix:"));
});

test("descartar e enviar no mesmo instante: vale o descarte; tarefa ativa sempre mostra 'corrigindo'", () => {
  assert.equal(fixState({ lastSeenAt: t(5), fixSentAt: t(6), dismissedAt: t(6), taskActive: false }), "dismissed");
  assert.equal(fixState({ lastSeenAt: t(9), fixSentAt: t(6), dismissedAt: null, taskActive: true }), "fixing");
});

test("achados: mesma impressão digital ignora caixa/acento; ids da fila; pedido ao Manager traz evidência e proíbe merge", () => {
  assert.equal(findingKey("API", "Rota sem checagem de empresa!"), findingKey("api", "rota SEM checagem de empresá"));
  assert.notEqual(findingKey("api", "a b c d"), findingKey("web", "a b c d"));
  assert.deepEqual(parseItemId("achado:abc"), { kind: "achado", rawId: "abc" });
  assert.deepEqual(parseItemId("erro:x:y"), { kind: "erro", rawId: "x:y" });
  assert.equal(parseItemId("abc"), null);
  const b = buildFindingBrief({ title: "Índice faltando em Pedido", detail: "seq scan 1,2 s", severity: "HIGH", category: "desempenho", application: "api", reportedBy: "ID Optimizer" });
  assert.match(b, /ID Optimizer/);
  assert.match(b, /seq scan/);
  assert.match(b, /não faça merge/);
});
