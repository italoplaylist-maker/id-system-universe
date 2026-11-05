import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";

type Handler = (event: unknown) => void;

/** Carrega public/sw.js num sandbox com um `self` falso: mesmo código que o navegador roda com o app FECHADO. */
function loadSw(opts: { ua: string; windows: Array<{ visibilityState: string; focused: boolean }> }) {
  const handlers: Record<string, Handler> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const self = {
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
    skipWaiting: () => Promise.resolve(),
    navigator: { userAgent: opts.ua },
    clients: { claim: () => Promise.resolve(), matchAll: async () => opts.windows, openWindow: async (u: string) => void shown.push({ title: `open:${u}`, options: {} }) },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
  };
  runInNewContext(readFileSync(join(process.cwd(), "public", "sw.js"), "utf8"), { self });
  const push = async (data: object) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.push({ data: { json: () => data, text: () => JSON.stringify(data) }, waitUntil: (p: Promise<unknown>) => void (pending = p) });
    await pending;
  };
  return { push, shown, handlers };
}

const ANDROID = "Mozilla/5.0 (Linux; Android 14) Chrome/120";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1";
const payload = { title: "Deploy concluído · Italoc", body: "ok", url: "/", tag: "dep:1", kind: "deploy" };

describe("service worker do push (app fechado)", () => {
  it("sem nenhuma aba aberta: mostra a notificação do sistema", async () => {
    const sw = loadSw({ ua: ANDROID, windows: [] });
    await sw.push(payload);
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].title, "Deploy concluído · Italoc");
    assert.equal(sw.shown[0].options.tag, "dep:1");
  });

  it("com a aba focada no computador/Android: não duplica (o pop-up do app já avisou)", async () => {
    const sw = loadSw({ ua: ANDROID, windows: [{ visibilityState: "visible", focused: true }] });
    await sw.push(payload);
    assert.equal(sw.shown.length, 0);
  });

  it("no iPhone mostra SEMPRE (a Apple exige), mesmo com o app aberto", async () => {
    const sw = loadSw({ ua: IPHONE, windows: [{ visibilityState: "visible", focused: true }] });
    await sw.push(payload);
    assert.equal(sw.shown.length, 1);
  });

  it("aba aberta mas em segundo plano: mostra", async () => {
    const sw = loadSw({ ua: ANDROID, windows: [{ visibilityState: "hidden", focused: false }] });
    await sw.push(payload);
    assert.equal(sw.shown.length, 1);
  });

  it("pedido de aprovação fica na tela até você agir", async () => {
    const sw = loadSw({ ua: ANDROID, windows: [] });
    await sw.push({ ...payload, kind: "approval", title: "Backend pede sua aprovação" });
    assert.equal(sw.shown[0].options.requireInteraction, true);
  });
});
