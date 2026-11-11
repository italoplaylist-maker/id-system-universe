import { test } from "node:test";
import assert from "node:assert/strict";
import { INCIDENT_TIMEOUT_HOURS, MAX_INCIDENT_ATTEMPTS, buildManagerBrief, decideOnFailure, incidentTooOld, logTail, mayMergeForIncident, normalizeRepo, prNumberFromCommitMessage, sameRepo } from "../src/lib/deploy-incidents";

test("o PR culpado sai da mensagem do commit (squash e merge) e o repositório é comparado sem se importar com a forma", () => {
  assert.equal(prNumberFromCommitMessage("Agentes CLT passam a ver os erros dos logs (#19)"), 19);
  assert.equal(prNumberFromCommitMessage("Merge pull request #7 from dono/branch\n\nmais texto"), 7);
  assert.equal(prNumberFromCommitMessage("Commit direto sem número"), null);
  assert.equal(prNumberFromCommitMessage("Fala do #5 no meio (e termina assim)"), null, "só vale o (#N) no fim");
  assert.equal(prNumberFromCommitMessage(null), null);
  assert.equal(normalizeRepo("https://github.com/Italo/Meu-Repo.git"), "italo/meu-repo");
  assert.equal(sameRepo("italo/meu-repo", "Italo/Meu-Repo"), true);
  assert.equal(sameRepo("italo/a", "italo/b"), false);
  assert.equal(sameRepo(null, null), false, "repositório desconhecido nunca casa");
});

test("falha de deploy: incidente novo, nova tentativa e escalada na 4ª falha", () => {
  assert.deepEqual(decideOnFailure(null), { kind: "new" });
  assert.deepEqual(decideOnFailure({ attempts: 1 }), { kind: "retry", attempts: 2 });
  assert.deepEqual(decideOnFailure({ attempts: MAX_INCIDENT_ATTEMPTS - 1 }), { kind: "retry", attempts: MAX_INCIDENT_ATTEMPTS });
  assert.deepEqual(decideOnFailure({ attempts: MAX_INCIDENT_ATTEMPTS }), { kind: "escalate", attempts: MAX_INCIDENT_ATTEMPTS + 1 });
  const t0 = new Date("2026-11-11T10:00:00Z");
  assert.equal(incidentTooOld(t0, new Date(t0.getTime() + (INCIDENT_TIMEOUT_HOURS * 3600_000 - 1))), false);
  assert.equal(incidentTooOld(t0, new Date(t0.getTime() + INCIDENT_TIMEOUT_HOURS * 3600_000)), true);
});

test("final do log: mantém o fim (onde está o erro) e respeita os limites", () => {
  const lines = Array.from({ length: 200 }, (_, i) => `linha ${i}`);
  const tail = logTail(lines, 5);
  assert.equal(tail, "linha 195\nlinha 196\nlinha 197\nlinha 198\nlinha 199");
  const big = logTail(["x".repeat(5000), "y".repeat(5000)], 10, 6000);
  assert.ok(big.length <= 6000 + 40 && big.endsWith("y".repeat(100)) && big.startsWith("[… início omitido …]"));
});

test("a tarefa do Manager traz os fatos, o bloqueio do culpado, a autoridade e as regras que continuam", () => {
  const brief = buildManagerBrief({ application: "Universe", repository: "italo/universe", commitSha: "7cff5d00b0be", commitMessage: "Algo (#19)\n\ncorpo", prNumber: 19, culpritAgent: "Universe", attempts: 2, logTail: "Error: boom", logNote: null, previousSummary: "Doctor tentou X" });
  for (const must of ["FALHOU", "tentativa 2 de 3", "7cff5d0", "PR #19", "BLOQUEADO", "Doctor tentou X", "Error: boom", "AUTORIDADE", "delegar_tarefa", "merge_pull_request", "CI estiver verde", "force-push"]) assert.ok(brief.includes(must), `faltou: ${must}`);
  const noLog = buildManagerBrief({ application: "A", repository: null, commitSha: null, commitMessage: null, prNumber: null, culpritAgent: null, attempts: 1, logTail: null, logNote: "token sem read:sensitive", previousSummary: null });
  assert.match(noLog, /indisponível: token sem read:sensitive/);
  assert.match(noLog, /listar_erros/);
  assert.match(noLog, /Não foi possível ligar o commit a um agente/);
});

const inc = { status: "OPEN", applicationRepo: "italo/universe", commitRepo: null, managerAgentId: "mgr" };

test("MERGE: só dentro de incidente aberto, no repositório certo e por quem faz parte do conserto", () => {
  const base = { agentId: "doc", prRepo: "Italo/Universe", incident: inc, delegatedAgentIds: ["doc"] };
  assert.deepEqual(mayMergeForIncident(base), { ok: true });
  assert.deepEqual(mayMergeForIncident({ ...base, agentId: "mgr", delegatedAgentIds: [] }), { ok: true }, "o Manager do incidente pode");
  const no = (patch: object) => mayMergeForIncident({ ...base, ...patch }) as { ok: false; reason: string };
  assert.match(no({ incident: null }).reason, /só fazem merge para consertar um incidente/);
  assert.match(no({ incident: { ...inc, status: "RESOLVED" } }).reason, /só fazem merge/);
  assert.match(no({ incident: { ...inc, status: "ESCALATED" } }).reason, /só fazem merge/);
  assert.match(no({ prRepo: "italo/outro-sistema" }).reason, /não é do repositório/);
  assert.match(no({ agentId: "intruso" }).reason, /não faz parte do conserto/);
  assert.match(no({ delegatedAgentIds: [], agentId: "doc" }).reason, /não faz parte do conserto/);
});
