import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma, resetDb } from "./helpers";
import { cleanupStorage, dirSize, getStorageReport } from "@/server/orchestrator/storage";

let tmp: string;
let cwd: string;
let agentId: string;

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};
const big = (path: string, kb: number) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.alloc(kb * 1024, 1));
};

describe("faxina do servidor (storage)", () => {
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "isu-storage-"));
    process.env.AGENTS_WORKSPACE_ROOT = join(tmp, "workspaces");
    process.env.HOME = join(tmp, "home");
    mkdirSync(join(tmp, "home", ".claude", "projects", "p1"), { recursive: true });
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  beforeEach(async () => {
    await resetDb();
    cwd = join(tmp, "workspaces", "italoc");
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });
    git(cwd, "init", "-b", "main");
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n.next\n");
    big(join(cwd, "src", "app.ts"), 1);
    big(join(cwd, "dist", "tracked.js"), 1); // "dist" versionada: NÃO pode ser apagada
    git(cwd, "add", "-A");
    git(cwd, "commit", "-m", "init");
    big(join(cwd, "node_modules", "pkg", "index.js"), 512);
    big(join(cwd, ".next", "cache", "x.bin"), 512);
    const agent = await prisma.agentProfile.create({ data: { name: "Italoc", cwd, permissionMode: "default", position: 0 } });
    agentId = agent.id;
  });

  it("apaga dependências/builds ignorados pelo Git, mas nunca pasta versionada nem o código", async () => {
    const before = await dirSize(cwd);
    const r = await cleanupStorage({ force: true });
    assert.ok(!existsSync(join(cwd, "node_modules")), "node_modules some");
    assert.ok(!existsSync(join(cwd, ".next")), ".next some");
    assert.ok(existsSync(join(cwd, "dist", "tracked.js")), "dist versionada fica");
    assert.ok(existsSync(join(cwd, "src", "app.ts")), "código fica");
    assert.ok(r.freedBytes >= 1024 * 1024 - 1, `liberou ${r.freedBytes}`);
    assert.ok((await dirSize(cwd)) < before);
  });

  it("não mexe em agente com tarefa ativa", async () => {
    await prisma.agentTask.create({ data: { agentId, prompt: "trabalhando", status: "RUNNING", idempotencyKey: "k1" } });
    await cleanupStorage({ force: true });
    assert.ok(existsSync(join(cwd, "node_modules")), "agente ativo mantém dependências");
  });

  it("sem force, respeita o tempo de ociosidade", async () => {
    await prisma.agentTask.create({ data: { agentId, prompt: "recente", status: "COMPLETED", idempotencyKey: "k2", finishedAt: new Date() } });
    await cleanupStorage();
    assert.ok(existsSync(join(cwd, "node_modules")), "parado há pouco: ainda não apaga");
  });

  it("cópia só local (sem origin) ou sem histórico de tarefas nunca é removida por inteiro", async () => {
    await cleanupStorage({ force: true });
    assert.ok(existsSync(join(cwd, "src", "app.ts")), "sem histórico: fica");
    const old = new Date(Date.now() - 90 * 86_400_000);
    await prisma.agentTask.create({ data: { agentId, prompt: "antiga", status: "COMPLETED", idempotencyKey: "k3", createdAt: old, finishedAt: old } });
    await cleanupStorage({ force: true });
    assert.ok(existsSync(join(cwd, "src", "app.ts")), "sem origin: fica, mesmo parada há 90 dias");
  });

  it("transcrições antigas saem; a da sessão em uso fica", async () => {
    const proj = join(tmp, "home", ".claude", "projects", "p1");
    const old = join(proj, "aaaa-old.jsonl");
    const keep = join(proj, "bbbb-keep.jsonl");
    big(old, 4);
    big(keep, 4);
    const past = new Date(Date.now() - 40 * 86_400_000);
    utimesSync(old, past, past);
    utimesSync(keep, past, past);
    await prisma.agentProfile.update({ where: { id: agentId }, data: { claudeSessionId: "bbbb-keep" } });
    await cleanupStorage({ force: true });
    assert.ok(!existsSync(old), "transcrição velha removida");
    assert.ok(existsSync(keep), "sessão em uso preservada");
  });

  it("apaga eventos de sincronização antigos e relata o uso", async () => {
    await prisma.universeEvent.create({ data: { type: "SYNC_COMPLETED", message: "Synced", createdAt: new Date(Date.now() - 5 * 86_400_000) } });
    await prisma.universeEvent.create({ data: { type: "SYNC_COMPLETED", message: "Synced agora" } });
    await cleanupStorage({ force: true });
    assert.equal(await prisma.universeEvent.count({ where: { type: "SYNC_COMPLETED" } }), 1);
    const rep = await getStorageReport();
    assert.ok(rep.memory.rssMB > 0);
    assert.ok(rep.workspaces.agents.some((a) => a.agentId === agentId));
  });
});
