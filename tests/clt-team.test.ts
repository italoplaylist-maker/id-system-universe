import { test } from "node:test";
import assert from "node:assert/strict";
import { CLT_DISALLOWED_TOOLS, CLT_RULES, CLT_TEAM, cltAllowedTools, cltRoleNote, evaluateBudget, findDuplicate, normalizePrompt, routeTask } from "../src/lib/clt-team";

test("a equipe tem os 7 cargos, slugs únicos e nenhum modo perigoso", () => {
  assert.equal(CLT_TEAM.length, 7);
  assert.equal(new Set(CLT_TEAM.map((a) => a.slug)).size, 7);
  assert.deepEqual(
    CLT_TEAM.map((a) => a.name),
    ["ID Manager", "ID Guardian", "ID Doctor", "ID QA", "ID Optimizer", "ID DevOps", "ID Architect"],
  );
  for (const a of CLT_TEAM) {
    assert.ok(a.permissionMode === "default" || a.permissionMode === "plan", `${a.name}: modo de permissão inseguro`);
    assert.ok(a.dailyTokenLimit > 0 && a.monthlyTokenLimit >= a.dailyTokenLimit);
  }
});

test("segurança: nada destrutivo ou de credencial fica liberado, e o bloqueio cobre as regras obrigatórias", () => {
  const allowed = cltAllowedTools();
  for (const rule of allowed) {
    assert.ok(!CLT_DISALLOWED_TOOLS.includes(rule), `${rule} está liberada e bloqueada ao mesmo tempo`);
    assert.ok(!/rm|sudo|migrate|db push|\.env|push/.test(rule), `${rule} não é somente leitura`);
  }
  const joined = CLT_DISALLOWED_TOOLS.join("|");
  for (const must of ["Bash(rm:*)", "prisma migrate", "prisma db push", "git push --force", "Read(.env)", "Edit(.env)", "docker volume rm"]) assert.ok(joined.includes(must), `falta bloquear ${must}`);
});

test("roteamento: especialista claro, pedido amplo vai para o Manager", () => {
  assert.equal(routeTask("Há uma vulnerabilidade de XSS no login?").slug, "id-guardian");
  assert.equal(routeTask("O Coolify está com o disco cheio na VPS").slug, "id-devops");
  assert.equal(routeTask("A tela dá erro 500 ao salvar").slug, "id-doctor");
  assert.equal(routeTask("Rode os testes e o typecheck").slug, "id-qa");
  assert.equal(routeTask("A query do relatório está lenta, falta índice").slug, "id-optimizer");
  assert.equal(routeTask("Atualize a documentação com a decisão de arquitetura").slug, "id-architect");
  const amplo = routeTask("Corrija o bug de deploy e rode os testes");
  assert.equal(amplo.slug, "id-manager");
  assert.equal(amplo.by, "manager");
  const vazio = routeTask("faça algo legal");
  assert.equal(vazio.slug, "id-manager");
  assert.equal(routeTask("Há uma vulnerabilidade de XSS no login?").by, "keywords");
});

test("duplicatas: ignora caixa, acento e pontuação", () => {
  assert.equal(normalizePrompt("  Rode os TESTES!! "), "rode os testes");
  const active = [{ id: "1", prompt: "Rode os testes." }];
  assert.equal(findDuplicate("rode os TESTES", active)?.id, "1");
  assert.equal(findDuplicate("rode o lint", active), undefined);
  assert.equal(findDuplicate("   ", active), undefined);
});

test("orçamento: ok, aviso a 80%, bloqueio a 100% (dia ou mês), sem limite = sem bloqueio", () => {
  const base = { usedDay: 0, usedMonth: 0, dailyLimit: 1000, monthlyLimit: 10_000 };
  assert.equal(evaluateBudget(base).level, "ok");
  assert.equal(evaluateBudget({ ...base, usedDay: 800 }).level, "warn");
  const day = evaluateBudget({ ...base, usedDay: 1000 });
  assert.equal(day.blocked, true);
  assert.match(day.reason ?? "", /diário/);
  const month = evaluateBudget({ ...base, usedDay: 10, usedMonth: 10_000 });
  assert.equal(month.blocked, true);
  assert.match(month.reason ?? "", /mensal/);
  const none = evaluateBudget({ usedDay: 9e9, usedMonth: 9e9, dailyLimit: null, monthlyLimit: null });
  assert.equal(none.blocked, false);
  assert.equal(none.dayPercent, null);
});

test("cada funcionário tem função concreta, e a nota do prompt usa a função editada + as regras da equipe", () => {
  for (const a of CLT_TEAM) {
    assert.ok(a.description.length > 200, `${a.name}: função curta demais`);
    assert.match(a.description, /Responsabilidades/, `${a.name}: função sem estrutura`);
  }
  const note = cltRoleNote({ name: "ID QA", roleTitle: "Qualidade", description: "Só rode testes." });
  assert.match(note, /Qualidade/);
  assert.match(note, /Só rode testes\./);
  for (const rule of CLT_RULES) assert.ok(note.includes(rule), "regra da equipe ausente do prompt");
});

test("escopo da equipe: só sai da pasta de um projeto; pasta escolhida de propósito não é mexida", async () => {
  const { cltNeedsNeutralCwd } = await import("../src/lib/clt-team");
  const { assignRepoDirs, slugDir } = await import("../src/lib/repo-dir");
  const neutral = "/srv/workspaces/clt";
  const projects = ["/srv/workspaces/construsil", "/srv/workspaces/padaria"];
  assert.equal(cltNeedsNeutralCwd("/srv/workspaces/construsil", projects, neutral), true, "presa a um projeto: corrige");
  assert.equal(cltNeedsNeutralCwd(neutral, projects, neutral), false, "já está na neutra");
  assert.equal(cltNeedsNeutralCwd("/srv/outra-pasta-minha", projects, neutral), false, "escolha manual: não mexe");
  assert.equal(slugDir("ID System Universe!"), "id-system-universe");
  const dirs = assignRepoDirs([{ id: "1", name: "Cérebro do Brabo" }, { id: "2", name: "construsil" }, { id: "3", name: "Construsil" }]);
  assert.equal(dirs.get("1"), "cerebro-do-brabo");
  assert.deepEqual([dirs.get("2"), dirs.get("3")], ["construsil", "construsil-2"], "nomes iguais ganham sufixo, nunca colidem");
});

test("o Doctor, o DevOps e o Manager sabem usar as ferramentas de erros/logs/estado (e as rotinas também)", async () => {
  const { CLT_ROUTINES } = await import("../src/lib/clt-routines");
  const by = (slug: string) => CLT_TEAM.find((a) => a.slug === slug)!.description;
  assert.match(by("id-doctor"), /listar_erros/);
  assert.match(by("id-doctor"), /ler_logs/);
  assert.match(by("id-devops"), /listar_erros/);
  assert.match(by("id-manager"), /status_equipe/);
  const prompt = (slug: string) => CLT_ROUTINES.filter((r) => r.slug === slug).map((r) => r.prompt).join(" ");
  assert.match(prompt("id-doctor"), /listar_erros/);
  assert.match(prompt("id-devops"), /listar_erros/);
  assert.match(prompt("id-manager"), /status_equipe/);
});

test("o Manager sabe delegar e, como ele e o Architect precisam agir, nenhum agente CLT nasce em modo 'somente planejar'", () => {
  const manager = CLT_TEAM.find((a) => a.slug === "id-manager")!;
  assert.match(manager.description, /delegar_tarefa/);
  assert.match(manager.description, /resultado_delegacoes/);
  for (const a of CLT_TEAM) assert.equal(a.permissionMode, "default", `${a.name}: modo plan impede de usar ferramentas e editar`);
  // a trava de segurança continua valendo para quem age: merge/deploy seguem bloqueados
  assert.ok(CLT_DISALLOWED_TOOLS.includes("mcp__universe__merge_pull_request"));
});
