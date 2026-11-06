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
import { updateAgent } from "@/server/orchestrator/service";

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
      if (url.startsWith("/installation/repositories")) return void res.end(JSON.stringify({ repositories: [{ id: 1, full_name: "acme/italoc", name: "italoc", owner: { login: "acme" }, default_branch: "main", private: true }] }));
      if (url.includes("/branches")) return void res.end(JSON.stringify([{ name: "main" }]));
      if (m === "GET" && url.startsWith("/repos/acme/italoc/pulls?")) {
        const head = decodeURIComponent(new URL(url, "http://x").searchParams.get("head") ?? "").split(":")[1];
        return void res.end(JSON.stringify(gh.prs.filter((p) => p.head === head && p.state === "open").map((p) => ({ number: p.number, html_url: p.html_url, title: p.title }))));
      }
      if (m === "POST" && url === "/repos/acme/italoc/pulls") {
        const b = JSON.parse(body);
        const number = gh.prs.length + 1;
        const pr = { number, html_url: `https://github.com/acme/italoc/pull/${number}`, title: b.title, head: b.head, state: "open", merged: false };
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

  it("rejeita repositório inexistente", async () => {
    const admin = await makeUser("ADMIN", "a4@test.dev");
    await assert.rejects(() => updateAgent(agentId, { githubRepositoryId: "nao-existe" }, { userId: admin.id }), /Repositório não encontrado/);
  });
});
