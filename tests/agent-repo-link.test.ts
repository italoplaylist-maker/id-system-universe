import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { makeUser, prisma, readBody, resetDb, startServer, type MockServer } from "./helpers";
import { setConfig } from "@/server/integrations/config";
import { connectInstallation } from "@/server/github/github-service";
import { getGitStatus, publishChanges, resolveAgentRepo } from "@/server/orchestrator/git/ops";
import { addExtraRepo, getAgentRepos, removeExtraRepo, updateAgent } from "@/server/orchestrator/service";
import { extraDir } from "@/server/orchestrator/repo-link";
import { loadExtraRepos } from "@/server/orchestrator/workspace";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const gh = { tokenCalls: 0, checksStatus: 200, perms: { contents: "write", pull_requests: "write", checks: "read", statuses: "read" } as Record<string, string>, prs: [] as Array<{ number: number; html_url: string; title: string; head: string; state: string; merged: boolean }>, checks: [] as Array<{ name: string; status: string; conclusion: string | null }>, mergeable: true as boolean | null, mergeCalls: 0 };
let server: MockServer;
let tmp: string;
let originDir: string;
let root: string;
let agentId: string;
let cwd: string;
let repoId: string;

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

describe("agente: conectar repositório direto (sem recurso do projeto)", () => {
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), "isu-git-"));
    originDir = join(tmp, "origin");
    root = join(tmp, "workspaces");
    mkdirSync(join(originDir, "acme"), { recursive: true });
    mkdirSync(root, { recursive: true });
    git(tmp, "init", "--bare", "-b", "main", join(originDir, "acme", "italoc.git"));
    const seed = join(tmp, "seed");
    mkdirSync(seed);
    git(seed, "init", "-b", "main");
    writeFileSync(join(seed, "README.md"), "# italoc\n");
    git(seed, "add", "-A");
    git(seed, "commit", "-m", "inicial");
    git(seed, "push", join(originDir, "acme", "italoc.git"), "main");
    git(tmp, "init", "--bare", "-b", "main", join(originDir, "acme", "brain.git"));
    const seed2 = join(tmp, "seed2");
    mkdirSync(seed2);
    git(seed2, "init", "-b", "main");
    writeFileSync(join(seed2, "CLAUDE.md"), "# cérebro\n");
    git(seed2, "add", "-A");
    git(seed2, "commit", "-m", "inicial");
    git(seed2, "push", join(originDir, "acme", "brain.git"), "main");
    process.env.GITHUB_GIT_URL = `file://${originDir}`;
    process.env.AGENTS_WORKSPACE_ROOT = root;

    server = await startServer(async (req, res) => {
      const body = await readBody(req);
      res.setHeader("content-type", "application/json");
      const url = req.url ?? "";
      const m = req.method ?? "GET";
      if (url.includes("/access_tokens")) {
        gh.tokenCalls += 1;
        return void res.end(JSON.stringify({ token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }));
      }
      if (/^\/app\/installations\/\d+$/.test(url)) return void res.end(JSON.stringify({ id: 4242, account: { login: "acme", type: "Organization", id: 1 }, repository_selection: "selected", permissions: gh.perms }));
      if (url.startsWith("/installation/repositories")) return void res.end(JSON.stringify({ repositories: [{ id: 1, full_name: "acme/italoc", name: "italoc", owner: { login: "acme" }, default_branch: "main", private: true }, { id: 2, full_name: "acme/brain", name: "brain", owner: { login: "acme" }, default_branch: "main", private: true }] }));
      if (url.includes("/branches")) return void res.end(JSON.stringify([{ name: "main" }]));
      if (m === "GET" && url.startsWith("/repos/acme/italoc/pulls?") || url.startsWith("/repos/acme/brain/pulls?")) {
        const head = decodeURIComponent(new URL(url, "http://x").searchParams.get("head") ?? "").split(":")[1];
        return void res.end(JSON.stringify(gh.prs.filter((p) => p.head === head && p.state === "open").map((p) => ({ number: p.number, html_url: p.html_url, title: p.title }))));
      }
      if (m === "POST" && (url === "/repos/acme/italoc/pulls" || url === "/repos/acme/brain/pulls")) {
        const b = JSON.parse(body);
        const number = gh.prs.length + 1;
        const pr = { number, html_url: `https://github.com/acme/${url.includes("/brain/") ? "brain" : "italoc"}/pull/${number}`, title: b.title, head: b.head, state: "open", merged: false };
        gh.prs.push(pr);
        res.statusCode = 201;
        return void res.end(JSON.stringify({ number, html_url: pr.html_url, title: pr.title }));
      }
      let mm = /^\/repos\/acme\/italoc\/pulls\/(\d+)$/.exec(url);
      if (m === "GET" && mm) {
        const pr = gh.prs.find((p) => p.number === Number(mm![1]));
        return void res.end(JSON.stringify({ state: pr?.state ?? "open", merged: pr?.merged ?? false, mergeable: gh.mergeable, mergeable_state: gh.mergeable === false ? "dirty" : "clean", head: { sha: "f".repeat(40), ref: pr?.head } }));
      }
      if (/check-runs/.test(url)) {
        res.statusCode = gh.checksStatus;
        return void res.end(JSON.stringify(gh.checksStatus === 200 ? { check_runs: gh.checks } : { message: "Resource not accessible by integration" }));
      }
      if (/\/status$/.test(url)) return void res.end(JSON.stringify({ state: "success", total_count: 0 }));
      mm = /^\/repos\/acme\/italoc\/pulls\/(\d+)\/merge$/.exec(url);
      if (m === "PUT" && mm) {
        gh.mergeCalls += 1;
        const pr = gh.prs.find((p) => p.number === Number(mm![1]));
        if (pr) {
          pr.merged = true;
          pr.state = "closed";
        }
        return void res.end(JSON.stringify({ merged: true }));
      }
      if (m === "DELETE") {
        res.statusCode = 204;
        return void res.end();
      }
      res.statusCode = 404;
      res.end("{}");
    });
    process.env.GITHUB_API_URL = server.url;
  });
  after(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    gh.perms = { contents: "write", pull_requests: "write", checks: "read", statuses: "read" };
    gh.tokenCalls = 0;
    gh.checksStatus = 200;
    gh.prs = [];
    gh.checks = [];
    gh.mergeable = true;
    gh.mergeCalls = 0;
    await setConfig("github.appId", "123456");
    await setConfig("github.privateKey", PEM);
    await setConfig("github.webhookSecret", "webhook-secret-for-tests-1234567890");
    const provider = await prisma.infrastructureProvider.create({ data: { name: "C", baseUrl: "http://127.0.0.1:1", encryptedToken: "x", health: "ONLINE" } });
    const project = await prisma.project.create({ data: { name: "Italoc", slug: "italoc" } });
    const app = await prisma.application.create({ data: { providerId: provider.id, externalId: "a1", projectId: project.id, name: "web", status: "RUNNING", resourceType: "APPLICATION", repository: "acme/italoc", branch: "main" } });
    const admin = await makeUser("ADMIN", "admin@test.dev");
    const inst = await connectInstallation("4242", { userId: admin.id });
    const repo = await prisma.gitHubRepository.findFirstOrThrow({ where: { installationId: inst.id, fullName: "acme/italoc" } });
    void app; void admin;
    repoId = repo.id;
    // cópia de trabalho do agente: clone real do "GitHub" local
    cwd = join(root, `italoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(cwd, { recursive: true }); // pasta vazia criada quando ainda não havia repositório
    agentId = (await prisma.agentProfile.create({ data: { name: "Backend Pro", cwd, projectId: project.id } })).id;
  });

  it("sem repositório conectado: mensagem pede para conectar no próprio agente", async () => {
    await assert.rejects(() => resolveAgentRepo(agentId), /Escolha um no próprio agente/);
    const st = await getGitStatus(agentId);
    assert.equal(st.hasRepo, false);
  });

  it("conectar direto no agente: resolve o repositório, clona na pasta vazia e já publica PR", async () => {
    const admin = await makeUser("ADMIN", "a2@test.dev");
    const r = await updateAgent(agentId, { githubRepositoryId: repoId }, { userId: admin.id });
    assert.equal((r as { prepare?: { ok: boolean } }).prepare?.ok, true);
    const info = await resolveAgentRepo(agentId);
    assert.equal(info.fullName, "acme/italoc");
    assert.ok(existsSync(join(cwd, ".git")), "clonou dentro da pasta vazia");
    assert.ok(existsSync(join(cwd, "README.md")));
    writeFileSync(join(cwd, "feature.ts"), "export const a = 1;\n");
    const pub = await publishChanges(agentId, { title: "Via conexão direta", taskId: "taskdirect01" });
    assert.equal(pub.pullRequest.number, 1);
  });

  it("pasta com arquivos e sem Git não é apagada: vai para backup e o repositório é clonado", async () => {
    writeFileSync(join(cwd, "trabalho.txt"), "não perca isto");
    const admin = await makeUser("ADMIN", "a3@test.dev");
    const r = (await updateAgent(agentId, { githubRepositoryId: repoId }, { userId: admin.id })) as { prepare?: { ok: boolean; message: string } };
    assert.equal(r.prepare?.ok, true);
    assert.match(r.prepare?.message ?? "", /Guardei tudo em/);
    const backup = (r.prepare?.message ?? "").match(/em (\S+) \(fica/)?.[1];
    assert.ok(backup && existsSync(join(backup, "trabalho.txt")), "arquivo preservado no backup");
    assert.ok(existsSync(join(cwd, ".git")));
  });

  it("repositório extra (o cérebro): clona ao lado, vira ref própria, publica PR nele sem tocar no principal", async () => {
    const admin = await makeUser("ADMIN", "a5@test.dev");
    await updateAgent(agentId, { githubRepositoryId: repoId }, { userId: admin.id });
    const brain = await prisma.gitHubRepository.findFirstOrThrow({ where: { fullName: "acme/brain" } });
    const r = await addExtraRepo(agentId, { githubRepositoryId: brain.id }, { userId: admin.id });
    assert.equal(r.added, 1);
    const view = await getAgentRepos(agentId);
    assert.equal(view.extras.length, 1);
    assert.equal(view.extras[0].dir, "brain");
    const dir = extraDir(cwd, "brain");
    assert.ok(existsSync(join(dir, ".git")), "extra clonado em <cwd>.extras/brain");
    assert.ok(!existsSync(join(cwd, "brain")), "e não dentro do principal");
    assert.deepEqual((await loadExtraRepos(agentId, cwd)).map((e) => e.fullName), ["acme/brain"]);

    const info = await resolveAgentRepo(agentId, "brain");
    assert.equal(info.fullName, "acme/brain");
    assert.equal(info.agent.cwd, dir);
    assert.equal((await resolveAgentRepo(agentId, "acme/brain")).repoRef, view.extras[0].id);
    assert.equal((await resolveAgentRepo(agentId)).fullName, "acme/italoc", "sem repo = principal");
    await assert.rejects(() => resolveAgentRepo(agentId, "acme/outro"), /não tem o repositório/);

    writeFileSync(join(dir, "nota.md"), "# decisão\n");
    const st = await getGitStatus(agentId, { repo: "brain" });
    assert.equal(st.repo, "acme/brain");
    assert.equal(st.changedFiles, 1);
    assert.equal((await getGitStatus(agentId)).changedFiles, 0, "principal intacto");
    const pub = await publishChanges(agentId, { title: "Registra decisão", taskId: "taskbrain001", repo: "brain" });
    assert.equal(pub.pullRequest.url.includes("/acme/brain/"), true);
    assert.equal((await getGitStatus(agentId, { repo: "brain" })).pullRequests.every((p) => p.repo === "acme/brain"), true);

    // desconectar: o vínculo sai; a cópia só é apagada se tudo foi enviado
    const rm = await removeExtraRepo(agentId, view.extras[0].id, { userId: admin.id });
    assert.equal((await getAgentRepos(agentId)).extras.length, 0);
    assert.equal(typeof rm.cleanup.removed, "boolean");
  });

  it("não adiciona o principal como extra nem duplica; applyToAll chega aos outros agentes", async () => {
    const admin = await makeUser("ADMIN", "a6@test.dev");
    await updateAgent(agentId, { githubRepositoryId: repoId }, { userId: admin.id });
    await assert.rejects(() => addExtraRepo(agentId, { githubRepositoryId: repoId }, { userId: admin.id }), /já é o repositório principal/);
    const brain = await prisma.gitHubRepository.findFirstOrThrow({ where: { fullName: "acme/brain" } });
    const other = await prisma.agentProfile.create({ data: { name: "Outro", cwd: join(root, `outro-${Date.now()}`), position: 5 } });
    const r = await addExtraRepo(agentId, { githubRepositoryId: brain.id, applyToAll: true }, { userId: admin.id });
    assert.equal(r.added, 2);
    assert.equal((await getAgentRepos(other.id)).extras.length, 1);
    await assert.rejects(() => addExtraRepo(agentId, { githubRepositoryId: brain.id }, { userId: admin.id }), /já está conectado/);
  });

  it("trava: mudar prisma/schema.prisma sem migração é recusado; com a migração passa", async () => {
    const admin = await makeUser("ADMIN", "a7@test.dev");
    await updateAgent(agentId, { githubRepositoryId: repoId }, { userId: admin.id });
    mkdirSync(join(cwd, "prisma"), { recursive: true });
    writeFileSync(join(cwd, "prisma", "schema.prisma"), "model X { id String @id }\n");
    await assert.rejects(() => publishChanges(agentId, { title: "schema sem migração", taskId: "taskschema01" }), /sem criar a migração/);
    mkdirSync(join(cwd, "prisma", "migrations", "20261109_x"), { recursive: true });
    writeFileSync(join(cwd, "prisma", "migrations", "20261109_x", "migration.sql"), "-- x\n");
    const pub = await publishChanges(agentId, { title: "schema com migração", taskId: "taskschema02" });
    assert.ok(pub.pullRequest.number >= 1);
  });

  it("rejeita repositório inexistente", async () => {
    const admin = await makeUser("ADMIN", "a4@test.dev");
    await assert.rejects(() => updateAgent(agentId, { githubRepositoryId: "nao-existe" }, { userId: admin.id }), /Repositório não encontrado/);
  });
});
