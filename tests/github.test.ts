import { prisma, resetDb, makeUser, startServer, readBody, startMockCoolify, type MockCoolify, type MockServer } from "./helpers";
import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { encryptSecret } from "@/server/crypto/encryption";
import { setConfig } from "@/server/integrations/config";
import { handleGitHubWebhook } from "@/server/github/webhook";
import { connectInstallation, createInstallState, listBranches, listRepositories, verifyInstallState } from "@/server/github/github-service";
import { setResourceRepository } from "@/server/github/resource-repository";
import { processDeploymentQueue, runDeploymentQueueTick } from "@/server/deployments/deployment-queue";
import { getRunsOverview } from "@/server/deployments/deployment-runs";
import { redeployApplication } from "@/server/applications/application-service";

const WEBHOOK_SECRET = "webhook-secret-for-tests-1234567890";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let github: MockServer;
const jwtState = { ok: false };
let coolify: MockCoolify;
let applicationId: string;
let projectId: string;
let delivery = 0;

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function send(event: string, payload: unknown, opts: { deliveryId?: string; secret?: string; processQueue?: boolean } = {}) {
  const body = JSON.stringify(payload);
  return handleGitHubWebhook(body, { signature: sign(body, opts.secret), deliveryId: opts.deliveryId ?? `d-${(delivery += 1)}`, event }, { processQueue: opts.processQueue ?? false });
}

const sha = (n: number) => String(n).padStart(40, "a");
const push = (n: number, ref = "refs/heads/main", repo = "acme/italoc") => ({
  ref,
  after: sha(n),
  deleted: false,
  repository: { full_name: repo, html_url: `https://github.com/${repo}` },
  head_commit: { id: sha(n), message: `commit ${n}\n\nbody`, url: `https://github.com/${repo}/commit/${sha(n)}`, author: { username: "dev" } },
});

describe("GitHub App + Auto Deploy", () => {
  before(async () => {
    const server = await startServer(async (req, res) => {
      await readBody(req);
      res.setHeader("content-type", "application/json");
      const auth = req.headers.authorization ?? "";
      if (req.url?.includes("/access_tokens")) {
        // valida o JWT do App (RS256) com a chave pública correspondente
        const [h, p, sig] = auth.replace("Bearer ", "").split(".");
        const verifier = createVerify("RSA-SHA256");
        verifier.update(`${h}.${p}`);
        jwtState.ok = verifier.verify(publicKey, Buffer.from(sig, "base64url"));
        res.end(JSON.stringify({ token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }));
      } else if (/^\/app\/installations\/\d+$/.test(req.url ?? "")) {
        res.end(JSON.stringify({ id: 4242, account: { login: "acme", type: "Organization", id: 1 }, repository_selection: "selected" }));
      } else if (req.url?.startsWith("/installation/repositories")) {
        res.end(JSON.stringify({ repositories: [
          { id: 1, full_name: "acme/italoc", name: "italoc", owner: { login: "acme" }, default_branch: "main", private: true },
          { id: 2, full_name: "acme/italoc-api", name: "italoc-api", owner: { login: "acme" }, default_branch: "main", private: true },
        ] }));
      } else if (req.url?.includes("/branches")) {
        res.end(JSON.stringify([{ name: "main" }, { name: "develop" }]));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    github = server;
    process.env.GITHUB_API_URL = github.url;
    coolify = await startMockCoolify();
  });
  after(async () => {
    await github.close();
    await coolify.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    coolify.deploys.length = 0;
    for (const k of Object.keys(coolify.deploymentStatus)) delete coolify.deploymentStatus[k];
    await setConfig("github.appId", "123456");
    await setConfig("github.privateKey", PRIVATE_PEM);
    await setConfig("github.webhookSecret", WEBHOOK_SECRET);
    await setConfig("github.appSlug", "id-system-universe");
    const provider = await prisma.infrastructureProvider.create({ data: { name: "Coolify Teste", baseUrl: coolify.url, encryptedToken: encryptSecret("coolify-token"), health: "ONLINE" } });
    const project = await prisma.project.create({ data: { name: "Italoc", slug: "italoc" } });
    projectId = project.id;
    const app = await prisma.application.create({
      data: { providerId: provider.id, externalId: "app-uuid-1", projectId, name: "web", status: "RUNNING", resourceType: "APPLICATION", repository: "acme/italoc", branch: "main" },
    });
    applicationId = app.id;
    const admin = await makeUser("ADMIN", "admin@test.dev");

    const installation = await connectInstallation("4242", { userId: admin.id });
    const repo = await prisma.gitHubRepository.findFirstOrThrow({ where: { installationId: installation.id, fullName: "acme/italoc" } });
    await setResourceRepository(applicationId, { githubRepositoryId: repo.id, branch: "main", autoDeploy: true, onPush: true, onMerge: true }, { userId: admin.id });
  });

  /** Termina o deploy `n` do mock com o commit informado. */
  const finish = (depId: string, status: string, commit: string) => {
    coolify.deploymentStatus[depId] = status;
    coolify.deploymentCommit[depId] = commit;
  };

  it("conectar: valida o JWT do App, lista repositórios e branches reais", async () => {
    assert.equal(jwtState.ok, true);
    const repos = await listRepositories();
    assert.deepEqual(repos.map((r) => r.fullName), ["acme/italoc", "acme/italoc-api"]);
    assert.deepEqual(await listBranches(repos[0].id), ["main", "develop"]);
    const installation = await prisma.gitHubInstallation.findFirstOrThrow();
    assert.equal(installation.accountLogin, "acme");
    assert.equal(installation.status, "ACTIVE");
  });

  it("state da instalação: assinado, atrelado ao usuário e com validade", () => {
    const state = createInstallState("user-1");
    assert.equal(verifyInstallState(state, "user-1"), true);
    assert.equal(verifyInstallState(state, "user-2"), false);
    assert.equal(verifyInstallState(`${state}x`, "user-1"), false);
    assert.equal(verifyInstallState(null, "user-1"), false);
    assert.equal(verifyInstallState(createInstallState("user-1", Date.now() - 2 * 3600_000), "user-1"), false);
  });

  it("webhook: assinatura inválida é rejeitada e nada é processado", async () => {
    const bad = await send("push", push(1), { secret: "wrong-secret-wrong-secret-12345" });
    assert.equal(bad.status, 401);
    const missing = await handleGitHubWebhook(JSON.stringify(push(1)), { signature: null, deliveryId: "x", event: "push" });
    assert.equal(missing.status, 401);
    assert.equal(await prisma.deploymentRun.count(), 0);
    assert.equal(await prisma.gitHubWebhookDelivery.count(), 0);
  });

  it("push em main enfileira e a fila dispara UM deploy no Coolify, guardando o commit", async () => {
    const result = await send("push", push(1));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.outcomes?.map((o) => o.result), ["QUEUED"]);

    assert.equal(await processDeploymentQueue(applicationId), "STARTED");
    assert.equal(coolify.deploys.length, 1);
    let run = await prisma.deploymentRun.findFirstOrThrow();
    assert.equal(run.status, "RUNNING");
    assert.equal(run.triggerSource, "GITHUB_PUSH");
    assert.equal(run.commitSha, sha(1));
    assert.equal(run.commitMessage, "commit 1");
    assert.equal(run.coolifyDeploymentId, "dep-1");
    const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    assert.equal(app.status, "DEPLOYING"); // o 3D reage a isto

    finish("dep-1", "finished", sha(1));
    await processDeploymentQueue(applicationId);
    run = await prisma.deploymentRun.findFirstOrThrow();
    assert.equal(run.status, "SUCCESS");
    assert.equal(run.deployedCommitSha, sha(1));
    assert.ok(run.finishedAt);
    const overview = await getRunsOverview(applicationId);
    assert.equal(overview.production?.commitSha, sha(1));
    assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status, "RUNNING");
  });

  it("deduplicação: mesmo delivery, mesmo commit em outro delivery e merge+push geram UM deploy", async () => {
    const first = await send("push", push(5), { deliveryId: "same" });
    const replay = await send("push", push(5), { deliveryId: "same" });
    assert.equal(replay.body.duplicate, true);
    const again = await send("push", push(5), { deliveryId: "other-delivery" });
    assert.deepEqual(again.body.outcomes?.map((o) => o.result), ["DUPLICATE"]);

    const merged = await send("pull_request", {
      action: "closed",
      repository: { full_name: "acme/italoc", html_url: "https://github.com/acme/italoc" },
      pull_request: { merged: true, merge_commit_sha: sha(5), title: "Feature", base: { ref: "main" }, merged_by: { login: "dev" } },
    });
    assert.deepEqual(merged.body.outcomes?.map((o) => o.result), ["DUPLICATE"]);
    assert.equal(first.body.outcomes?.[0].result, "QUEUED");

    assert.equal(await prisma.deploymentRun.count(), 1);
    await Promise.all([processDeploymentQueue(applicationId), processDeploymentQueue(applicationId)]);
    assert.equal(coolify.deploys.length, 1);
  });

  it("branch incorreta, repositório sem vínculo, push de tag e branch apagada não geram deploy", async () => {
    assert.deepEqual((await send("push", push(1, "refs/heads/feature-x"))).body.outcomes, []);
    assert.deepEqual((await send("push", push(1, "refs/heads/main", "acme/outro"))).body.outcomes, []);
    assert.deepEqual((await send("push", push(1, "refs/tags/v1"))).body.outcomes, []);
    assert.deepEqual((await send("push", { ...push(1), deleted: true })).body.outcomes, []);
    assert.equal(await prisma.deploymentRun.count(), 0);
  });

  it("merge registra GITHUB_MERGE; Auto Deploy desligado ou evento desativado não implanta", async () => {
    const merged = await send("pull_request", {
      action: "closed",
      repository: { full_name: "acme/italoc", html_url: "https://github.com/acme/italoc" },
      pull_request: { merged: true, merge_commit_sha: sha(9), title: "Merge feature", base: { ref: "main" }, merged_by: { login: "lead" } },
    });
    assert.equal(merged.body.outcomes?.[0].result, "QUEUED");
    assert.equal((await prisma.deploymentRun.findFirstOrThrow()).triggerSource, "GITHUB_MERGE");

    // PR fechado sem merge: ignorado.
    const notMerged = await send("pull_request", { action: "closed", repository: { full_name: "acme/italoc" }, pull_request: { merged: false, merge_commit_sha: sha(10), base: { ref: "main" } } });
    assert.deepEqual(notMerged.body.outcomes, []);

    await prisma.resourceRepository.update({ where: { applicationId }, data: { onPush: false } });
    assert.equal((await send("push", push(11))).body.outcomes?.[0].result, "SKIPPED");
    await prisma.resourceRepository.update({ where: { applicationId }, data: { autoDeploy: false, onPush: true } });
    assert.deepEqual((await send("push", push(12))).body.outcomes, []);
    assert.equal(await prisma.deploymentRun.count(), 1);
  });

  it("fila: A em deploy, B e C chegam → só C é implantado depois de A; B vira SUPERSEDED (histórico preservado)", async () => {
    await send("push", push(1));
    assert.equal(await processDeploymentQueue(applicationId), "STARTED"); // A rodando
    await send("push", push(2)); // B
    await send("push", push(3)); // C
    assert.equal(await processDeploymentQueue(applicationId), "BUSY"); // nunca dois ao mesmo tempo
    assert.equal(coolify.deploys.length, 1);

    finish("dep-1", "finished", sha(1)); // A termina
    assert.equal(await processDeploymentQueue(applicationId), "STARTED"); // C começa
    assert.equal(coolify.deploys.length, 2);

    const runs = await prisma.deploymentRun.findMany({ orderBy: { receivedAt: "asc" } });
    assert.deepEqual(runs.map((r) => [r.commitSha, r.status]), [[sha(1), "SUCCESS"], [sha(2), "SUPERSEDED"], [sha(3), "RUNNING"]]);

    finish("dep-2", "finished", sha(3));
    await runDeploymentQueueTick();
    assert.equal((await prisma.deploymentRun.findFirstOrThrow({ where: { commitSha: sha(3) } })).status, "SUCCESS");
    assert.equal((await getRunsOverview(applicationId)).production?.commitSha, sha(3));
    assert.equal(coolify.deploys.length, 2); // B nunca foi implantado
  });

  it("falha no Coolify: run FAILED com status real, sem inventar sucesso", async () => {
    await send("push", push(1));
    await processDeploymentQueue(applicationId);
    finish("dep-1", "failed", sha(1));
    await processDeploymentQueue(applicationId);
    const run = await prisma.deploymentRun.findFirstOrThrow();
    assert.equal(run.status, "FAILED");
    assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status, "ERROR");
    assert.equal((await getRunsOverview(applicationId)).production, null);
  });

  it("deploy manual também gera run (MANUAL) e bloqueia a fila enquanto roda", async () => {
    const operator = await makeUser("OPERATOR", "op@test.dev", [], [projectId]);
    await redeployApplication(applicationId, false, { userId: operator.id });
    assert.equal((await prisma.deploymentRun.findFirstOrThrow()).triggerSource, "MANUAL");
    await send("push", push(7));
    assert.equal(await processDeploymentQueue(applicationId), "BUSY");
    assert.equal(coolify.deploys.length, 1);
    finish("dep-1", "finished", sha(0));
    assert.equal(await processDeploymentQueue(applicationId), "STARTED");
    assert.equal(coolify.deploys.length, 2);
  });

  it("evento installation (deleted) marca a instalação e remove repositórios", async () => {
    await send("installation", { action: "deleted", installation: { id: 4242, account: { login: "acme", type: "Organization", id: 1 } } });
    assert.equal((await prisma.gitHubInstallation.findFirstOrThrow()).status, "DELETED");
    assert.equal(await prisma.gitHubRepository.count(), 0);
  });

  it("GitHub fora do ar não derruba nada: listar repositórios usa o cache local", async () => {
    process.env.GITHUB_API_URL = "http://127.0.0.1:1";
    try {
      const repos = await listRepositories();
      assert.equal(repos.length, 2);
      await assert.rejects(() => listBranches(repos[0].id));
    } finally {
      process.env.GITHUB_API_URL = github.url;
    }
  });

  it("após um webhook válido o servidor dispara o deploy sozinho (sem ninguém clicar)", async () => {
    const result = await send("push", push(21), { processQueue: true });
    assert.equal(result.status, 200);
    for (let i = 0; i < 50 && coolify.deploys.length === 0; i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.equal(coolify.deploys.length, 1);
    assert.equal((await prisma.deploymentRun.findFirstOrThrow()).status, "RUNNING");
  });
});
