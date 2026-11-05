import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { makeUser, prisma, resetDb } from "./helpers";
import { notify } from "@/server/notifications/notify";
import { setPushSender, type PushTarget } from "@/server/notifications/push";
import { universeEventToNotification } from "@/server/notifications/from-events";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { getVapidKeys, resetVapidCache } from "@/server/notifications/vapid";
import { notificationBus, type BusMessage } from "@/server/notifications/bus";
import type { NotificationPayload } from "@/server/notifications/types";

let sent: Array<{ endpoint: string; payload: NotificationPayload }> = [];
let deadEndpoints = new Set<string>();

async function sub(userId: string, endpoint: string) {
  await prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: "k".repeat(20), auth: "a".repeat(12) } });
}
const settle = () => new Promise((r) => setTimeout(r, 60));

describe("notificações (pop-up + push)", () => {
  before(() => resetVapidCache());
  beforeEach(async () => {
    await resetDb();
    sent = [];
    deadEndpoints = new Set();
    setPushSender(async (t: PushTarget, payload) => {
      if (deadEndpoints.has(t.endpoint)) return { ok: false, gone: true };
      sent.push({ endpoint: t.endpoint, payload });
      return { ok: true };
    });
  });
  afterEach(() => setPushSender(null));

  it("deploy concluído chega ao celular e ao computador de quem tem acesso", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    await sub(admin.id, "https://push.example/phone");
    await sub(admin.id, "https://push.example/desktop");
    await recordUniverseEvent({ type: "DEPLOYMENT_COMPLETED", message: "Deploy do app terminou.", applicationName: "Italoc" });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint).sort(), ["https://push.example/desktop", "https://push.example/phone"]);
    assert.equal(sent[0].payload.title, "Deploy concluído · Italoc");
    assert.equal(sent[0].payload.level, "success");
  });

  it("respeita as preferências: quem desligou 'deploys' não recebe", async () => {
    const a = await makeUser("ADMIN", "a@x.com");
    const b = await makeUser("ADMIN", "b@x.com");
    await sub(a.id, "https://push.example/a");
    await sub(b.id, "https://push.example/b");
    await prisma.notificationPreference.create({ data: { userId: b.id, deploys: false } });
    await recordUniverseEvent({ type: "DEPLOYMENT_FAILED", message: "Falhou.", applicationName: "X" });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint), ["https://push.example/a"]);
  });

  it("escopo de projeto: operador só recebe o que é do projeto dele; sem projeto, só acesso global", async () => {
    const p1 = await prisma.project.create({ data: { name: "P1", slug: "p1" } });
    const p2 = await prisma.project.create({ data: { name: "P2", slug: "p2" } });
    const op = await makeUser("OPERATOR", "op@x.com", [], [p1.id]);
    const admin = await makeUser("ADMIN", "ad@x.com");
    await sub(op.id, "https://push.example/op");
    await sub(admin.id, "https://push.example/admin");
    await recordUniverseEvent({ type: "DEPLOYMENT_COMPLETED", message: "ok", projectId: p2.id });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint), ["https://push.example/admin"], "operador não vê o projeto 2");
    sent = [];
    await recordUniverseEvent({ type: "DEPLOYMENT_COMPLETED", message: "ok", projectId: p1.id });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint).sort(), ["https://push.example/admin", "https://push.example/op"]);
    sent = [];
    await recordUniverseEvent({ type: "DEPLOYMENT_COMPLETED", message: "sem projeto" });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint), ["https://push.example/admin"], "evento sem projeto: só global");
  });

  it("financeiro só vai a quem tem permissão de cobrança", async () => {
    const viewer = await makeUser("ADMIN", "plain@x.com");
    const fin = await makeUser("SUPERADMIN", "fin@x.com");
    await sub(viewer.id, "https://push.example/v");
    await sub(fin.id, "https://push.example/f");
    await notify({ kind: "billing", level: "warning", title: "Atraso", body: "x", audience: { permission: "billing:view" } });
    await settle();
    // ADMIN tem billing:view? o que importa: quem NÃO tem, não recebe — compara com a regra real
    const { canUser } = await import("@/server/auth/rbac");
    const expected = [viewer, fin].filter((u) => canUser(u, "billing:view")).map((u) => (u.id === viewer.id ? "https://push.example/v" : "https://push.example/f"));
    assert.deepEqual(sent.map((s) => s.endpoint).sort(), expected.sort());
  });

  it("aviso de teste vai só para quem pediu", async () => {
    const a = await makeUser("ADMIN", "a@x.com");
    const b = await makeUser("ADMIN", "b@x.com");
    await sub(a.id, "https://push.example/a");
    await sub(b.id, "https://push.example/b");
    await notify({ kind: "test", level: "success", title: "t", body: "b", audience: { userId: a.id } });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint), ["https://push.example/a"]);
  });

  it("aparelho que revogou (410/404) é removido; os demais seguem", async () => {
    const a = await makeUser("ADMIN", "a@x.com");
    await sub(a.id, "https://push.example/ok");
    await sub(a.id, "https://push.example/dead");
    deadEndpoints.add("https://push.example/dead");
    await notify({ kind: "server", level: "error", title: "Caiu", body: "x", audience: { requireGlobal: true } });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint), ["https://push.example/ok"]);
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: "https://push.example/dead" } }), 0);
  });

  it("pop-up (SSE): o barramento entrega o mesmo aviso com a audiência para filtrar", async () => {
    const got: BusMessage[] = [];
    const off = notificationBus.subscribe((m) => got.push(m));
    await notify({ kind: "agent", level: "success", title: "Backend terminou", body: "ok", audience: { permission: "provider:read", requireGlobal: true } });
    off();
    assert.equal(got.length, 1);
    assert.equal(got[0].payload.title, "Backend terminou");
    assert.equal(got[0].audience.requireGlobal, true);
  });

  it("só eventos que valem aviso viram notificação (sincronização e atribuição ficam de fora)", () => {
    assert.equal(universeEventToNotification({ type: "SYNC_COMPLETED", message: "x" }), null);
    assert.equal(universeEventToNotification({ type: "RESOURCE_ASSIGNED", message: "x" }), null);
    assert.equal(universeEventToNotification({ type: "DEPLOYMENT_STARTED", message: "x" }), null);
    assert.equal(universeEventToNotification({ type: "SERVER_OFFLINE", message: "x" })?.audience.requireGlobal, true);
  });

  it("chaves VAPID: geradas uma vez, guardadas (privada cifrada) e iguais depois de reiniciar", async () => {
    resetVapidCache();
    const first = await getVapidKeys();
    resetVapidCache();
    const second = await getVapidKeys();
    assert.equal(first.publicKey, second.publicKey);
    assert.equal(first.privateKey, second.privateKey);
    const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key: "vapid.private" } });
    assert.ok(!row.value.includes(first.privateKey), "privada não pode estar em texto puro");
  });
});
