import { prisma, resetDb, makeUser } from "./helpers";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { ValidationError } from "@/lib/errors";
import { setExecutor, type ExecutorRunInput, type TaskExecutor } from "@/server/orchestrator/executor";
import { createAgent, decideTaskApproval, getTaskDetail, listRoomAgents, listTasks, submitTask, updateAgent, updateSettings } from "@/server/orchestrator/service";
import { setWorkspacePreparer, syncProjectAgents } from "@/server/orchestrator/workspace";
import { archiveAgent } from "@/server/orchestrator/service";
import { cancelTask, dispatch, idle, recoverStale } from "@/server/orchestrator/worker";

let actor: { userId: string };
let agentId: string;
let n = 0;
const key = () => `key-${Date.now()}-${++n}-abcdef`;

/** Executor controlável: cada execução espera `release()` — simula o Claude trabalhando sem rede. */
class FakeExecutor implements TaskExecutor {
  runs: ExecutorRunInput[] = [];
  gates = new Map<string, () => void>();
  mode: "ok" | "fail" | "approval" | "resumeFail" = "ok";
  calls = 0;
  async run(input: ExecutorRunInput) {
    this.calls += 1;
    this.runs.push(input);
    // A porta existe desde o início: soltar antes de o executor chegar nela não se perde.
    const gate = new Promise<void>((resolve, reject) => {
      this.gates.set(input.taskId, resolve);
      input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    gate.catch(() => undefined);
    if (this.mode === "resumeFail" && input.resumeSessionId) {
      const { ExecutorStartError } = await import("@/server/orchestrator/executor");
      throw new ExecutorStartError("No conversation found");
    }
    if (this.mode === "fail") throw new Error("Claude indisponível: 401 invalid x-api-key");
    await input.onStarted({ sessionId: input.resumeSessionId ?? `sess-${input.taskId.slice(-6)}`, model: "claude-test" });
    await input.onToolUse("Read", "src/a.ts");
    if (this.mode === "approval") {
      const d = await input.canUseTool("Bash", { command: "npm test" });
      if (!d.allow) throw new Error(`negado: ${d.message}`);
    }
    await gate;
    await input.onText("feito");
    return { sessionId: input.resumeSessionId ?? `sess-${input.taskId.slice(-6)}`, result: "pronto", costUsd: 0.01, turns: 2 };
  }
  release(taskId: string) {
    this.gates.get(taskId)?.();
  }
  releaseAll() {
    for (const r of this.gates.values()) r();
  }
}

let exec: FakeExecutor;

async function waitFor(cond: () => Promise<boolean>, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout esperando condição");
}

const statusOf = async (id: string) => (await prisma.agentTask.findUniqueOrThrow({ where: { id } })).status;

describe("Orquestrador de agentes Claude", () => {
  after(async () => {
    setExecutor(null);
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb();
    actor = { userId: (await makeUser("ADMIN", "owner@x.com")).id };
    exec = new FakeExecutor();
    setExecutor(exec);
    setWorkspacePreparer(async () => undefined);
    agentId = (await createAgent({ name: "Ana", cwd: "/srv/app", specialty: "Backend" }, actor)).id;
  });
  afterEach(async () => {
    exec.releaseAll();
    await idle();
  });

  it("enviar registra e responde na hora; a execução começa sozinha (sem ENTER) e só vira EXECUTANDO após o Claude iniciar", async () => {
    const { task, duplicate } = await submitTask(agentId, { prompt: "rode os testes", idempotencyKey: key() }, actor);
    assert.equal(duplicate, false);
    assert.equal(task.status, "QUEUED", "resposta imediata: registrada, ainda não iniciada");
    await dispatch();
    await waitFor(async () => (await statusOf(task.id)) === "RUNNING");
    await waitFor(async () => (await getTaskDetail(task.id)).events.some((e) => e.kind === "tool_use"));
    const detail = await getTaskDetail(task.id);
    assert.deepEqual(detail.events.map((e) => e.kind).slice(0, 3), ["message_sent", "started", "tool_use"]);
    assert.equal(exec.runs[0].prompt, "rode os testes");
    assert.equal(exec.runs[0].cwd, "/srv/app");
    exec.release(task.id);
    await idle();
    const done = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.result, "pronto");
    assert.ok(done.claudeSessionId);
  });

  it("não executa nada enquanto o executor não confirmou o início (STARTING)", async () => {
    let confirm!: () => void;
    const slow: TaskExecutor = {
      async run(input) {
        await new Promise<void>((r) => (confirm = r));
        await input.onStarted({ sessionId: "s1" });
        return { result: "ok" };
      },
    };
    setExecutor(slow);
    const { task } = await submitTask(agentId, { prompt: "x", idempotencyKey: key() }, actor);
    await dispatch();
    await waitFor(async () => (await statusOf(task.id)) === "STARTING");
    assert.equal(await statusOf(task.id), "STARTING");
    confirm();
    await idle();
    assert.equal(await statusOf(task.id), "COMPLETED");
  });

  it("um clique = uma execução: a mesma chave devolve a mesma tarefa, inclusive em paralelo", async () => {
    const k = key();
    const results = await Promise.all([1, 2, 3, 4].map(() => submitTask(agentId, { prompt: "once", idempotencyKey: k }, actor)));
    assert.equal(new Set(results.map((r) => r.task.id)).size, 1);
    assert.equal(results.filter((r) => !r.duplicate).length, 1);
    assert.equal(await prisma.agentTask.count(), 1);
    await dispatch();
    await waitFor(async () => exec.calls === 1);
    await dispatch();
    assert.equal(exec.calls, 1, "uma única execução");
  });

  it("várias tarefas: registra sem esperar; um agente executa uma por vez e a fila anda sozinha", async () => {
    const a = (await submitTask(agentId, { prompt: "A", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(a.id)) === "RUNNING");
    const b = (await submitTask(agentId, { prompt: "B", idempotencyKey: key() }, actor)).task;
    const c = (await submitTask(agentId, { prompt: "C", idempotencyKey: key() }, actor)).task;
    await dispatch();
    assert.equal(await statusOf(b.id), "QUEUED", "B espera: o agente está ocupado");
    const queue = await listTasks({ scope: "active" });
    assert.deepEqual(queue.filter((t) => t.status === "QUEUED").map((t) => [t.prompt, t.queuePosition]), [["B", 1], ["C", 2]]);
    exec.release(a.id);
    await waitFor(async () => (await statusOf(b.id)) === "RUNNING");
    assert.equal(await statusOf(c.id), "QUEUED");
    exec.release(b.id);
    await waitFor(async () => (await statusOf(c.id)) === "RUNNING");
    exec.release(c.id);
    await idle();
    assert.equal(await statusOf(c.id), "COMPLETED");
  });

  it("respeita o limite global de execuções simultâneas entre agentes", async () => {
    const other = (await createAgent({ name: "Beto", cwd: "/srv/b" }, actor)).id;
    const third = (await createAgent({ name: "Caio", cwd: "/srv/c" }, actor)).id;
    await updateSettings({ maxConcurrent: 2 }, actor);
    const t1 = (await submitTask(agentId, { prompt: "1", idempotencyKey: key() }, actor)).task;
    const t2 = (await submitTask(other, { prompt: "2", idempotencyKey: key() }, actor)).task;
    const t3 = (await submitTask(third, { prompt: "3", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t1.id)) === "RUNNING" && (await statusOf(t2.id)) === "RUNNING");
    assert.equal(await statusOf(t3.id), "QUEUED", "limite 2: a terceira espera");
    exec.release(t1.id);
    await waitFor(async () => (await statusOf(t3.id)) === "RUNNING");
    exec.releaseAll();
    await idle();
  });

  it("falha do Claude: erro registrado, histórico preservado, agente continua existindo e a fila segue", async () => {
    exec.mode = "fail";
    const t1 = (await submitTask(agentId, { prompt: "vai falhar", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await idle();
    const failed = await prisma.agentTask.findUniqueOrThrow({ where: { id: t1.id } });
    assert.equal(failed.status, "FAILED");
    assert.match(failed.error ?? "", /401/);
    const events = (await getTaskDetail(t1.id)).events.map((e) => e.kind);
    assert.ok(events.includes("message_sent") && events.includes("failed"));
    const room = await listRoomAgents();
    assert.equal(room.length, 1, "o funcionário continua na sala");
    assert.equal(room[0].state, "ERROR");
    exec.mode = "ok";
    const t2 = (await submitTask(agentId, { prompt: "de novo", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t2.id)) === "RUNNING");
    exec.releaseAll();
    await idle();
    assert.equal(await statusOf(t2.id), "COMPLETED");
    assert.equal((await listTasks({ scope: "history" })).length, 2, "histórico preservado");
  });

  it("sessão persistente: a segunda tarefa retoma a sessão da primeira (contexto preservado)", async () => {
    const t1 = (await submitTask(agentId, { prompt: "1", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t1.id)) === "RUNNING");
    exec.release(t1.id);
    await idle();
    const session = (await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentId } })).claudeSessionId;
    assert.ok(session);
    const t2 = (await submitTask(agentId, { prompt: "2", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => exec.runs.length === 2);
    assert.equal(exec.runs[1].resumeSessionId, session);
    exec.releaseAll();
    await idle();
    void t2;
  });

  it("sessão salva sumiu e nada executou: recomeça sessão nova uma única vez, sem perder a tarefa", async () => {
    await prisma.agentProfile.update({ where: { id: agentId }, data: { claudeSessionId: "sess-antiga" } });
    exec.mode = "resumeFail";
    const t = (await submitTask(agentId, { prompt: "oi", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t.id)) === "RUNNING");
    assert.equal(exec.runs.length, 2);
    assert.equal(exec.runs[0].resumeSessionId, "sess-antiga");
    assert.equal(exec.runs[1].resumeSessionId, null);
    assert.ok((await getTaskDetail(t.id)).events.some((e) => e.kind === "info" && /nova sessão/.test(e.text ?? "")));
    exec.releaseAll();
    await idle();
  });

  it("aprovação: a tarefa espera no painel (não é falha técnica) e segue ao aprovar; negar não executa", async () => {
    exec.mode = "approval";
    const t = (await submitTask(agentId, { prompt: "precisa de bash", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t.id)) === "WAITING_APPROVAL");
    const detail = await getTaskDetail(t.id);
    assert.equal(detail.approval?.tool, "Bash");
    assert.equal(detail.approval?.detail, "npm test");
    assert.equal((await listRoomAgents())[0].state, "WAITING");
    await decideTaskApproval(detail.approval!.id, { decision: "allow" }, actor);
    await waitFor(async () => (await statusOf(t.id)) === "RUNNING");
    await assert.rejects(decideTaskApproval(detail.approval!.id, { decision: "deny" }, actor), ValidationError, "decide uma vez só");
    exec.releaseAll();
    await idle();
    assert.equal(await statusOf(t.id), "COMPLETED");

    const t2 = (await submitTask(agentId, { prompt: "de novo", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t2.id)) === "WAITING_APPROVAL");
    await decideTaskApproval((await getTaskDetail(t2.id)).approval!.id, { decision: "deny" }, actor);
    await idle();
    const denied = await prisma.agentTask.findUniqueOrThrow({ where: { id: t2.id } });
    assert.equal(denied.status, "FAILED");
    assert.match(denied.error ?? "", /negado/);
  });

  it("cancelar: na fila nunca executa; em execução aborta o Claude", async () => {
    const a = (await submitTask(agentId, { prompt: "A", idempotencyKey: key() }, actor)).task;
    const b = (await submitTask(agentId, { prompt: "B", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(a.id)) === "RUNNING");
    await cancelTask(b.id, actor);
    assert.equal(await statusOf(b.id), "CANCELLED");
    await cancelTask(a.id, actor);
    await idle();
    assert.equal(await statusOf(a.id), "CANCELLED");
    assert.equal(exec.calls, 1, "B cancelada nunca foi executada");
    await assert.rejects(cancelTask(a.id, actor), ValidationError, "já terminou");
  });

  it("recuperação: worker que caiu deixa tarefa INTERRUPTED (sem repetir sozinha); a fila segue; sem duplicar", async () => {
    const t = (await submitTask(agentId, { prompt: "longa", idempotencyKey: key() }, actor)).task;
    // simula execução que pertencia a um processo anterior: status ativo, batida velha, nada vivo aqui
    await prisma.agentTask.update({ where: { id: t.id }, data: { status: "RUNNING", startedAt: new Date(Date.now() - 120_000), heartbeatAt: new Date(Date.now() - 120_000) } });
    const queued = (await submitTask(agentId, { prompt: "depois", idempotencyKey: key() }, actor)).task;
    assert.equal(await recoverStale(), 1);
    assert.equal(await recoverStale(), 0, "idempotente");
    const row = await prisma.agentTask.findUniqueOrThrow({ where: { id: t.id } });
    assert.equal(row.status, "INTERRUPTED");
    assert.ok((await getTaskDetail(t.id)).events.some((e) => e.kind === "interrupted"));
    assert.equal(exec.calls, 0, "não reexecuta sozinha");
    await dispatch();
    await waitFor(async () => (await statusOf(queued.id)) === "RUNNING");
    exec.releaseAll();
    await idle();
  });

  it("não toca em execução saudável nem na fila ao recuperar", async () => {
    const t = (await submitTask(agentId, { prompt: "viva", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t.id)) === "RUNNING");
    assert.equal(await recoverStale(new Date(Date.now() + 5 * 60_000)), 0, "esta execução está viva neste processo");
    exec.releaseAll();
    await idle();
  });

  it("agente pausado fica na sala, não executa e as tarefas esperam na fila", async () => {
    await updateAgent(agentId, { paused: true }, actor);
    const t = (await submitTask(agentId, { prompt: "p", idempotencyKey: key() }, actor)).task;
    await dispatch();
    assert.equal(await statusOf(t.id), "QUEUED");
    assert.equal((await listRoomAgents())[0].state, "PAUSED");
    await updateAgent(agentId, { paused: false }, actor);
    await dispatch();
    await waitFor(async () => (await statusOf(t.id)) === "RUNNING");
    exec.releaseAll();
    await idle();
  });

  it("funcionário permanente: existe sem tarefas, mantém ordem e identidade", async () => {
    const b = (await createAgent({ name: "Beto", cwd: "/srv/b" }, actor)).id;
    const room1 = await listRoomAgents();
    const room2 = await listRoomAgents();
    assert.deepEqual(room1.map((a) => a.id), [agentId, b]);
    assert.deepEqual(room1.map((a) => a.id), room2.map((a) => a.id));
    assert.ok(room1.every((a) => a.state === "AVAILABLE"));
  });

  it("valida comando, chave e diretório", async () => {
    await assert.rejects(submitTask(agentId, { prompt: "  ", idempotencyKey: key() }, actor), ValidationError);
    await assert.rejects(submitTask(agentId, { prompt: "x", idempotencyKey: "curta" }, actor), ValidationError);
    await assert.rejects(createAgent({ name: "Z", cwd: "relativo" }, actor), ValidationError);
  });

  it("segredos no comando de aprovação e nos eventos são redigidos", async () => {
    exec.mode = "approval";
    const custom: TaskExecutor = {
      async run(input) {
        await input.onStarted({ sessionId: "s" });
        await input.canUseTool("Bash", { command: "API_KEY=supersecret123 deploy" });
        return { result: "ok" };
      },
    };
    setExecutor(custom);
    const t = (await submitTask(agentId, { prompt: "x", idempotencyKey: key() }, actor)).task;
    await dispatch();
    await waitFor(async () => (await statusOf(t.id)) === "WAITING_APPROVAL");
    const d = await getTaskDetail(t.id);
    assert.ok(!d.approval!.detail.includes("supersecret123"));
    await decideTaskApproval(d.approval!.id, { decision: "deny" }, actor);
    await idle();
  });

  it("um funcionário por Projeto, criado sozinho, sem duplicar e sem ressuscitar quem foi removido", async () => {
    const p = await prisma.project.create({ data: { name: "Construsil", slug: "construsil" } });
    assert.equal(await syncProjectAgents(), 1);
    assert.equal(await syncProjectAgents(), 0);
    const agent = await prisma.agentProfile.findFirstOrThrow({ where: { projectId: p.id } });
    assert.equal(agent.name, "Construsil");
    assert.ok(agent.cwd.endsWith("/construsil"));
    await archiveAgent(agent.id, actor);
    assert.equal(await syncProjectAgents(), 0);
  });
});
