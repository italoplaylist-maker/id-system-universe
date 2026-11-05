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
import { setResourceRepository } from "@/server/github/resource-repository";
import { cleanupWorkspace, diffHasSecret, getGitStatus, mergePullRequest, publishChanges } from "@/server/orchestrator/git/ops";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const gh = { perms: { contents: "write", pull_requests: "write" } as Record<string, string>, prs: [] as Array<{ number: number; html_url: string; title: string; head: string; state: string; merged: boolean }>, checks: [] as Array<{ name: string; status: string; conclusion: string | null }>, mergeable: true as boolean | null, mergeCalls: 0 };
let server: MockServer;
let tmp: string;
let originDir: string;
let root: string;
let agentId: string;
let cwd: string;

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const bare = (...args: string[]) => git(join(originDir, "acme", "italoc.git"), ...args);

describe("agente → GitHub (commit, PR, merge, limpeza)", () => {
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
      if (url.includes("/access_tokens")) return void res.end(JSON.stringify({ token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }));
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
      if (/check-runs/.test(url)) return void res.end(JSON.stringify({ check_runs: gh.checks }));
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
    gh.perms = { contents: "write", pull_requests: "write" };
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
    await setResourceRepository(app.id, { githubRepositoryId: repo.id, branch: "main", autoDeploy: false, onPush: false, onMerge: false }, { userId: admin.id });
    // cópia de trabalho do agente: clone real do "GitHub" local
    cwd = join(root, `italoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    git(root, "clone", join(originDir, "acme", "italoc.git"), cwd);
    agentId = (await prisma.agentProfile.create({ data: { name: "Backend Pro", cwd, projectId: project.id } })).id;
  });

  it("publica: branch própria, commit com a identidade do agente, PR aberto, principal intocada", async () => {
    const mainBefore = bare("rev-parse", "main");
    writeFileSync(join(cwd, "feature.ts"), "export const a = 1;\n");
    const r = await publishChanges(agentId, { title: "Adiciona feature", taskId: "taskabcd1234" });
    assert.match(r.branch, /^agente\/backend-pro\//);
    assert.equal(r.pullRequest.number, 1);
    assert.equal(bare("rev-parse", "main"), mainBefore, "a branch principal não pode mudar");
    assert.ok(bare("branch", "--list", r.branch).includes(r.branch), "branch existe no remoto");
    assert.match(bare("log", "-1", "--format=%an", r.branch), /Backend Pro/);
    const row = await prisma.agentPullRequest.findFirstOrThrow();
    assert.equal(row.status, "OPEN");
    assert.equal(row.baseBranch, "main");
    await assert.rejects(() => publishChanges(agentId), /nada para enviar/i);
  });

  it("recusa arquivos sensíveis e chaves no diff, sem commitar nada", async () => {
    writeFileSync(join(cwd, ".env"), "X=1\n");
    await assert.rejects(() => publishChanges(agentId), /sens[ií]ve/i);
    assert.equal(git(cwd, "log", "--oneline").split("\n").length, 1, "nenhum commit novo");
    git(cwd, "reset", "-q");
    writeFileSync(join(cwd, ".env"), "", "utf8");
    git(cwd, "clean", "-fdq");
    writeFileSync(join(cwd, "cfg.ts"), `const t = "ghp_${"a1B2c3D4e5F6g7H8i9J0".repeat(2)}";\n`);
    await assert.rejects(() => publishChanges(agentId), /segredo/i);
    assert.equal(diffHasSecret("+const key={i}\n+maxTokens=5"), false, "código normal não é segredo");
  });

  it("sem permissão de escrita no App: explica exatamente o que falta", async () => {
    gh.perms = { contents: "read", pull_requests: "read" };
    writeFileSync(join(cwd, "a.ts"), "1");
    await assert.rejects(() => publishChanges(agentId), /Contents: Read & write.*Pull requests: Read & write/);
    const st = await getGitStatus(agentId, { checkPermissions: true });
    assert.deepEqual(st.missingPermissions, ["Contents: Read & write", "Pull requests: Read & write"]);
  });

  it("merge só com verificações verdes e sem conflito; squash; depois apaga a cópia", async () => {
    writeFileSync(join(cwd, "f.ts"), "1");
    await publishChanges(agentId, { title: "T" });
    const pr = await prisma.agentPullRequest.findFirstOrThrow();

    gh.checks = [{ name: "ci", status: "in_progress", conclusion: null }];
    await assert.rejects(() => mergePullRequest(pr.id), /ainda está rodando/);
    gh.checks = [{ name: "ci", status: "completed", conclusion: "failure" }];
    await assert.rejects(() => mergePullRequest(pr.id), /falhou/);
    gh.checks = [{ name: "ci", status: "completed", conclusion: "success" }];
    gh.mergeable = false;
    await assert.rejects(() => mergePullRequest(pr.id), /conflito/);
    assert.equal(gh.mergeCalls, 0, "nenhum merge foi pedido ao GitHub");

    gh.mergeable = true;
    assert.ok(existsSync(cwd));
    const r = await mergePullRequest(pr.id);
    assert.equal(r.merged, true);
    assert.equal(r.cleanup.removed, true);
    assert.equal(existsSync(cwd), false, "cópia apagada depois do merge");
    assert.equal((await prisma.agentPullRequest.findUniqueOrThrow({ where: { id: pr.id } })).status, "MERGED");
    assert.ok(await prisma.agentProfile.findUnique({ where: { id: agentId } }), "o funcionário continua existindo");
  });

  it("não apaga a cópia com trabalho não enviado, tarefa na fila ou fora da pasta dos agentes", async () => {
    // alterações sem commit
    writeFileSync(join(cwd, "x.ts"), "1");
    let r = await cleanupWorkspace(agentId);
    assert.equal(r.removed, false);
    assert.match(r.reason ?? "", /sem commit/);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-m", "local");
    r = await cleanupWorkspace(agentId);
    assert.equal(r.removed, false);
    assert.match(r.reason ?? "", /não foram para o GitHub/);
    assert.ok(existsSync(cwd));

    // tudo enviado, mas com tarefa na fila
    await publishChanges(agentId, { title: "ok" });
    await prisma.agentTask.create({ data: { agentId, prompt: "p", idempotencyKey: "k-busy-12345" } });
    r = await cleanupWorkspace(agentId);
    assert.equal(r.removed, false);
    assert.match(r.reason ?? "", /tarefa/);
    await prisma.agentTask.deleteMany();
    assert.equal((await cleanupWorkspace(agentId)).removed, true);

    // diretório fora da pasta dos agentes: nunca apaga
    const outside = mkdtempSync(join(tmpdir(), "isu-outside-"));
    writeFileSync(join(outside, "importante.txt"), "x");
    const other = await prisma.agentProfile.create({ data: { name: "Fora", cwd: outside } });
    const o = await cleanupWorkspace(other.id);
    assert.equal(o.removed, false);
    assert.ok(existsSync(join(outside, "importante.txt")));
  });

  it("nunca envia direto para a principal: com mudanças na main, cria branch nova", async () => {
    assert.equal(git(cwd, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    const before = bare("rev-parse", "main");
    writeFileSync(join(cwd, "novo.ts"), "1");
    const r = await publishChanges(agentId, { title: "x" });
    assert.notEqual(r.branch, "main");
    assert.equal(bare("rev-parse", "main"), before);
  });
});
