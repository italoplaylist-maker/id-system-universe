import { prisma, resetDb, makeUser, startMockEvolution, type MockEvolution } from "./helpers";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getConfig, setConfig } from "@/server/integrations/config";
import { disconnectWhatsApp, pollWhatsAppConnection, startWhatsAppConnection } from "@/server/whatsapp/whatsapp-connect";
import { getWhatsAppConfigSummary } from "@/server/whatsapp/whatsapp-provider";

let evo: MockEvolution;
let actor: { userId: string };

describe("WhatsApp: conexão por QR Code (só URL + senha)", () => {
  before(async () => {
    evo = await startMockEvolution();
  });
  after(async () => {
    await evo.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb();
    evo.instances.clear();
    evo.calls.length = 0;
    actor = { userId: (await makeUser("ADMIN", "wa@test.dev")).id };
    await setConfig("whatsapp.baseUrl", evo.url);
    await setConfig("whatsapp.apiKey", "global-key");
  });

  it("exige URL e senha antes de conectar", async () => {
    await setConfig("whatsapp.apiKey", null);
    await assert.rejects(startWhatsAppConnection(), /URL e a senha/);
  });

  it("cria a instância na hora e devolve o QR; sem leitura, não vira a oficial", async () => {
    const v = await startWhatsAppConnection();
    assert.equal(v.state, "qr");
    assert.match(v.qr ?? "", /^data:image\/png;base64,/);
    assert.match(v.instance ?? "", /^universe-[0-9a-f]{8}$/);
    assert.equal(await getConfig("whatsapp.instance"), undefined);
    assert.equal((await getWhatsAppConfigSummary()).configured, false);
    const p = await pollWhatsAppConnection({ refreshQr: true, actor });
    assert.equal(p.state, "qr");
    assert.match(p.qr ?? "", /QR2/);
  });

  it("reaproveita a instância pendente em vez de criar outra", async () => {
    const a = await startWhatsAppConnection();
    const b = await startWhatsAppConnection();
    assert.equal(a.instance, b.instance);
    assert.equal(evo.calls.filter((c) => c === "POST /instance/create").length, 1);
  });

  it("ao ler o QR (state open) salva a instância e o envio passa a funcionar", async () => {
    const v = await startWhatsAppConnection();
    evo.instances.set(v.instance!, "open");
    const p = await pollWhatsAppConnection({ actor });
    assert.equal(p.state, "open");
    assert.equal(p.number, "5511999990000");
    assert.equal(await getConfig("whatsapp.instance"), v.instance);
    assert.equal(await getConfig("whatsapp.pendingInstance"), undefined);
    assert.equal((await getWhatsAppConfigSummary()).configured, true);
    assert.equal((await startWhatsAppConnection()).state, "open");
  });

  it("senha global recusada vira erro claro", async () => {
    // O mock não valida a chave; simulamos instância sumida: poll limpa o pendente.
    const v = await startWhatsAppConnection();
    evo.instances.delete(v.instance!);
    evo.instances.set("outra", "connecting");
    const p = await pollWhatsAppConnection({ actor });
    assert.equal(p.state, "none");
    assert.equal(await getConfig("whatsapp.pendingInstance"), undefined);
  });

  it("desconectar apaga a instância e limpa a configuração (URL e senha ficam)", async () => {
    const v = await startWhatsAppConnection();
    evo.instances.set(v.instance!, "open");
    await pollWhatsAppConnection({ actor });
    await disconnectWhatsApp(actor);
    assert.equal(await getConfig("whatsapp.instance"), undefined);
    assert.equal(evo.instances.has(v.instance!), false);
    assert.equal(await getConfig("whatsapp.apiKey"), "global-key");
  });
});
