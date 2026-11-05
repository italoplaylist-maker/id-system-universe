import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { makeUser, prisma, resetDb } from "./helpers";
import { notify, sendTestNotification, deviceLabel } from "@/server/notifications/notify";
import { setWhatsAppNotifySender } from "@/server/notifications/whatsapp-channel";
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

  it("WhatsApp: chega para quem ligou (mesmo sem push), respeita categorias e não repete o mesmo aviso", async () => {
    const wa: Array<{ phone: string; text: string }> = [];
    setWhatsAppNotifySender(async (phone, text) => void wa.push({ phone, text }));
    const a = await makeUser("ADMIN", "a@x.com");
    const b = await makeUser("ADMIN", "b@x.com");
    const c = await makeUser("ADMIN", "c@x.com");
    await prisma.notificationPreference.create({ data: { userId: a.id, whatsappEnabled: true, whatsappNumber: "5511912345678" } });
    await prisma.notificationPreference.create({ data: { userId: b.id, whatsappEnabled: true, whatsappNumber: "5511987654321", deploys: false } });
    await prisma.notificationPreference.create({ data: { userId: c.id, whatsappEnabled: false, whatsappNumber: "5511900000000" } });
    await notify({ kind: "deploy", level: "success", title: "Deploy concluído · Italoc", body: "ok", tag: "dep:1", audience: {} });
    assert.deepEqual(wa.map((m) => m.phone), ["5511912345678"], "só quem ligou e quer deploys");
    assert.match(wa[0].text, /✅ \*Deploy concluído · Italoc\*/);
    await notify({ kind: "deploy", level: "success", title: "Deploy concluído · Italoc", body: "ok", tag: "dep:1", audience: {} });
    assert.equal(wa.length, 1, "mesma tag em 5 min não repete");
    await notify({ kind: "approval", level: "warning", title: "Backend pede sua aprovação", body: "Bash", tag: "ap:1", audience: {} });
    assert.deepEqual(wa.slice(1).map((m) => m.phone).sort(), ["5511912345678", "5511987654321"]);
    setWhatsAppNotifySender(null);
  });

  it("diagnóstico: falha do serviço de push fica registrada no aparelho e o teste mostra o motivo", async () => {
    const a = await makeUser("ADMIN", "a@x.com");
    await prisma.pushSubscription.create({ data: { userId: a.id, endpoint: "https://push.example/ios", p256dh: "k".repeat(20), auth: "a".repeat(12), userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1" } });
    setPushSender(async () => ({ ok: false, gone: false, detail: "HTTP 403 — o serviço de push recusou a identificação do servidor" }));
    const r = await sendTestNotification(a.id, "push");
    assert.equal(r.push.length, 1);
    assert.equal(r.push[0].ok, false);
    assert.match(r.push[0].detail ?? "", /403/);
    assert.equal(r.push[0].device, "iPhone · Safari");
    const row = await prisma.pushSubscription.findFirstOrThrow();
    assert.match(row.lastError ?? "", /403/);
    setPushSender(async () => ({ ok: true }));
    const ok = await sendTestNotification(a.id, "push");
    assert.equal(ok.push[0].ok, true);
    assert.equal((await prisma.pushSubscription.findFirstOrThrow()).lastError, null);
    assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120"), "Windows · Chrome");
  });

  it("entrega real (sem simulador): o push sai cifrado (aes128gcm), com assinatura VAPID, e o aparelho consegue ler o conteúdo", async () => {
    // "serviço de push" local em HTTPS que recebe o pedido como o da Apple/Google receberia
    const dir = mkdtempSync(join(tmpdir(), "isu-tls-"));
    const gen = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { encoding: "utf8" });
    assert.equal(gen.status, 0, "openssl gerou o certificado");
    const received: { headers: Record<string, string | string[] | undefined>; body: Buffer } = { headers: {}, body: Buffer.alloc(0) };
    const srv = https.createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => {
        received.headers = req.headers;
        received.body = Buffer.concat(chunks);
        res.statusCode = 201;
        res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      // chaves do "aparelho" (o navegador as gera): par ECDH P-256 + segredo de autenticação
      const device = createECDH("prime256v1");
      device.generateKeys();
      const authSecret = randomBytes(16);
      const u = await makeUser("ADMIN", "real@x.com");
      await prisma.pushSubscription.create({ data: { userId: u.id, endpoint: `https://127.0.0.1:${port}/push/abc`, p256dh: device.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") } });
      setPushSender(null); // sender de verdade (web-push)
      const r = await sendTestNotification(u.id, "push");
      assert.equal(r.push[0].ok, true, `entrega falhou: ${r.push[0].detail}`);
      assert.equal(received.headers["content-encoding"], "aes128gcm");
      assert.match(String(received.headers.authorization), /^vapid t=.+, k=.+/, "assinatura VAPID presente");
      assert.ok(Number(received.headers.ttl) > 0);
      // o aparelho decifra com a sua chave privada
      // @ts-expect-error o pacote não traz tipos
      const eceMod = (await import("http_ece")) as { default?: unknown };
      const ece = (eceMod.default ?? eceMod) as { decrypt: (b: Buffer, p: object) => Buffer };
      const plain = ece.decrypt(received.body, { version: "aes128gcm", privateKey: device, authSecret });
      const payload = JSON.parse(plain.toString("utf8"));
      assert.equal(payload.title, "Notificações funcionando");
      assert.equal(payload.kind, "test");
    } finally {
      if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
      await new Promise((r) => srv.close(r));
    }
  });
});
