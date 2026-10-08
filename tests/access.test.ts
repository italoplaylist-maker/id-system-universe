import { prisma, resetDb, makeUser } from "./helpers";
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { ForbiddenError } from "@/lib/errors";
import { canUser } from "@/server/auth/rbac";
import { assertApplicationAccess, assertProjectAccess, getProjectScope } from "@/server/auth/project-access";
import { listApplications } from "@/server/applications/application-service";
import { listProjects } from "@/server/projects/project-service";
import { listProviders } from "@/server/providers/provider-service";
import { listRecentUniverseEvents, recordUniverseEvent } from "@/server/events/universe-events";
import { createUser, updateUser } from "@/server/users/user-service";
import { createClient, getClientDetail, listClients } from "@/server/billing/client-service";
import { createCharge, getBillingCounts, getChargeDetail, listCharges, payCharge } from "@/server/billing/charge-service";
import type { SessionUser } from "@/server/auth/session";

let ids: Record<string, string>;
let userA: SessionUser; // Italoc + FinFlow
let userB: SessionUser; // Construsil
let superadmin: SessionUser;
let admin: SessionUser;

describe("Acesso por projeto", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    const projects = await Promise.all(["Italoc", "FinFlow", "Construsil"].map((name) => prisma.project.create({ data: { name, slug: name.toLowerCase() } })));
    const [italoc, finflow, construsil] = projects;
    const shared = await prisma.infrastructureProvider.create({ data: { name: "Servidor Compartilhado", baseUrl: "https://coolify.internal", encryptedToken: "x", lastError: "segredo de infra" } });
    const solo = await prisma.infrastructureProvider.create({ data: { name: "Servidor Construsil", baseUrl: "https://solo.internal", encryptedToken: "x" } });
    const app = (name: string, projectId: string | null, providerId: string) =>
      prisma.application.create({ data: { name, projectId, providerId, externalId: `${name}-uuid`, status: "RUNNING" } });
    const [aItaloc, aFin, aConstrusil, aOrphan] = await Promise.all([
      app("italoc-web", italoc.id, shared.id),
      app("finflow-api", finflow.id, shared.id),
      app("construsil-web", construsil.id, shared.id),
      app("orphan", null, shared.id),
    ]);
    const aSolo = await app("construsil-db", construsil.id, solo.id);
    ids = { italoc: italoc.id, finflow: finflow.id, construsil: construsil.id, aItaloc: aItaloc.id, aFin: aFin.id, aConstrusil: aConstrusil.id, aOrphan: aOrphan.id, aSolo: aSolo.id, shared: shared.id, solo: solo.id };

    userA = await makeUser("OPERATOR", "a@test.dev", ["BILLING_VIEW"], [italoc.id, finflow.id]);
    userB = await makeUser("OPERATOR", "b@test.dev", [], [construsil.id]);
    superadmin = await makeUser("SUPERADMIN", "root@test.dev");
    admin = await makeUser("ADMIN", "admin@test.dev");
  });

  it("escopo: SUPERADMIN/ADMIN globais; OPERATOR só os projetos concedidos", async () => {
    assert.deepEqual(await getProjectScope(superadmin), { all: true });
    assert.deepEqual(await getProjectScope(admin), { all: true });
    const a = await getProjectScope(userA);
    assert.equal(a.all, false);
    if (!a.all) assert.deepEqual([...a.projectIds].sort(), [ids.italoc, ids.finflow].sort());
  });

  it("Projects e Resources: cada usuário vê só o seu; recurso sem projeto só o global", async () => {
    const names = async (user: SessionUser) => (await listApplications({ scope: await getProjectScope(user) })).map((r) => r.name).sort();
    assert.deepEqual(await names(userA), ["finflow-api", "italoc-web"]);
    assert.deepEqual(await names(userB), ["construsil-db", "construsil-web"]);
    assert.equal((await names(superadmin)).length, 5);
    assert.deepEqual((await listProjects({ scope: await getProjectScope(userA) })).map((p) => p.name).sort(), ["FinFlow", "Italoc"]);
    assert.equal((await listProjects({ scope: await getProjectScope(userB) })).length, 1);
    // filtro explícito por projeto proibido não vaza
    assert.equal((await listApplications({ scope: await getProjectScope(userA), projectId: ids.construsil })).length, 0);
    assert.equal((await listApplications({ scope: await getProjectScope(userA), unassignedOnly: true })).length, 0);
  });

  it("acesso direto a projeto/recurso proibido é 403 — inclusive id inexistente (sem vazar existência)", async () => {
    await assert.rejects(() => assertProjectAccess(userA, ids.construsil), ForbiddenError);
    await assert.rejects(() => assertApplicationAccess(userA, ids.aConstrusil), ForbiddenError);
    await assert.rejects(() => assertApplicationAccess(userA, ids.aOrphan), ForbiddenError);
    await assert.rejects(() => assertApplicationAccess(userB, ids.aItaloc), ForbiddenError);
    await assert.rejects(() => assertApplicationAccess(userB, "nao-existe"), ForbiddenError);
    await assertProjectAccess(userA, ids.italoc);
    await assertApplicationAccess(userB, ids.aSolo);
    await assertApplicationAccess(superadmin, ids.aOrphan);
  });

  it("servidores relacionados: só os que hospedam recursos visíveis, sem detalhes de infra", async () => {
    const forA = await listProviders(await getProjectScope(userA));
    assert.deepEqual(forA.map((p) => p.name), ["Servidor Compartilhado"]);
    assert.equal(forA[0].applicationCount, 2); // só os recursos visíveis
    assert.equal(forA[0].baseUrl, "");
    assert.equal(forA[0].lastError, null);
    const forB = await listProviders(await getProjectScope(userB));
    assert.deepEqual(forB.map((p) => p.name).sort(), ["Servidor Compartilhado", "Servidor Construsil"]);
    const forRoot = await listProviders(await getProjectScope(superadmin));
    assert.equal(forRoot.length, 2);
    assert.equal(forRoot[0].baseUrl, "https://coolify.internal");
  });

  it("feed de eventos respeita projeto e permissão financeira", async () => {
    await recordUniverseEvent({ type: "DEPLOYMENT_COMPLETED", message: "italoc ok", projectId: ids.italoc });
    await recordUniverseEvent({ type: "DEPLOYMENT_COMPLETED", message: "construsil ok", projectId: ids.construsil });
    await recordUniverseEvent({ type: "SYNC_COMPLETED", message: "global" });
    await recordUniverseEvent({ type: "BILLING_OVERDUE", message: "2 vencidas", projectId: ids.italoc, permission: "billing:view" });
    const messages = async (user: SessionUser) => (await listRecentUniverseEvents(50, { scope: await getProjectScope(user), user })).map((e) => e.message).sort();
    assert.deepEqual(await messages(userA), ["2 vencidas", "italoc ok"]); // tem BILLING_VIEW
    assert.deepEqual(await messages(userB), ["construsil ok"]); // sem permissão financeira e sem eventos globais
    assert.equal((await messages(superadmin)).length, 4);
    assert.equal((await messages(admin)).includes("2 vencidas"), false); // ADMIN sem permissão extra não vê financeiro
  });

  it("permissões financeiras: role + extras", () => {
    assert.equal(canUser(superadmin, "billing:manage"), true);
    assert.equal(canUser(admin, "billing:view"), false);
    assert.equal(canUser(userA, "billing:view"), true);
    assert.equal(canUser(userA, "billing:manage"), false);
    assert.equal(canUser({ role: "VIEWER", extraPermissions: ["BILLING_MANAGE"] }, "billing:view"), true);
    assert.equal(canUser(userB, "billing:view"), false);
    assert.equal(canUser(userB, "application:redeploy"), true);
    assert.equal(canUser({ role: "VIEWER" }, "application:redeploy"), false);
    assert.equal(canUser(userB, "integration:manage"), false);
  });

  it("cobranças e clientes obedecem ao Project Access", async () => {
    const clientItaloc = await createClient({ name: "Cliente Italoc", projectIds: [ids.italoc] }, superadmin, { userId: superadmin.id });
    const clientConstrusil = await createClient({ name: "Cliente Construsil", projectIds: [ids.construsil] }, superadmin, { userId: superadmin.id });
    const mk = (clientId: string, projectId: string | null) => createCharge({ clientId, projectId, description: "x", amountCents: 1000, dueDate: "2020-01-01", rules: [] }, superadmin, { userId: superadmin.id });
    const c1 = await mk(clientItaloc.id, ids.italoc);
    const c2 = await mk(clientConstrusil.id, ids.construsil);
    const c3 = await mk(clientItaloc.id, null); // sem projeto: só global

    const forA = await listCharges({}, userA);
    assert.deepEqual(forA.items.map((c) => c.id), [c1.id]);
    assert.equal(forA.total, 1);
    await assert.rejects(() => getChargeDetail(c2.id, userA), ForbiddenError);
    await assert.rejects(() => getChargeDetail(c3.id, userA), ForbiddenError);
    await assert.rejects(() => payCharge(c2.id, {}, userA, { userId: userA.id }), ForbiddenError);
    assert.deepEqual((await listClients(await getProjectScope(userA))).map((c) => c.name), ["Cliente Italoc"]);
    await assert.rejects(() => getClientDetail(clientConstrusil.id, userA), ForbiddenError);
    assert.equal((await listCharges({}, superadmin)).total, 3);
    assert.deepEqual(await getBillingCounts(userA), { pending: 1, overdue: 1, dueToday: 0 });
    assert.equal((await getBillingCounts(superadmin)).pending, 3);
    // criar cobrança em projeto fora do escopo
    await assert.rejects(() => createCharge({ clientId: clientItaloc.id, projectId: ids.construsil, description: "y", amountCents: 100, dueDate: "2030-01-01" }, userA, { userId: userA.id }), ForbiddenError);
  });

  it("gestão de usuários: ADMIN não cria SUPERADMIN nem concede financeiro; projetos permitidos persistem", async () => {
    const actorAdmin = { userId: admin.id, role: admin.role };
    await assert.rejects(() => createUser({ email: "x@test.dev", password: "SenhaForte#12345", role: "SUPERADMIN" }, actorAdmin), ForbiddenError);
    await assert.rejects(() => createUser({ email: "y@test.dev", password: "SenhaForte#12345", role: "VIEWER", extraPermissions: ["BILLING_VIEW"] }, actorAdmin), ForbiddenError);

    const created = await createUser({ email: "novo@test.dev", password: "SenhaForte#12345", role: "OPERATOR", projectIds: [ids.italoc] }, actorAdmin);
    assert.deepEqual(created.projectIds, [ids.italoc]);
    const updated = await updateUser(created.id, { projectIds: [ids.finflow, ids.construsil] }, actorAdmin);
    assert.deepEqual([...updated.projectIds].sort(), [ids.finflow, ids.construsil].sort());
    const cleared = await updateUser(created.id, { projectIds: [] }, actorAdmin);
    assert.deepEqual(cleared.projectIds, []);

    const actorRoot = { userId: superadmin.id, role: superadmin.role };
    const withBilling = await updateUser(created.id, { extraPermissions: ["BILLING_MANAGE"] }, actorRoot);
    assert.deepEqual(withBilling.extraPermissions, ["BILLING_MANAGE"]);
    await assert.rejects(() => updateUser(superadmin.id, { role: "VIEWER" }, actorAdmin), ForbiddenError);
  });
});
