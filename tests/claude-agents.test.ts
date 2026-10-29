import { prisma, resetDb, makeUser } from "./helpers";
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { UnauthorizedLikeError, ValidationError } from "@/lib/errors";
import { cancelCommand, createFeed, deriveAgentState, listCommands, queueCommand, getSessionTimeline, ingestHookEvent, listActiveSessions, pruneAgentData, redactSecrets, rotateFeedToken } from "@/server/claude/agent-service";

let actor: { userId: string };
let token: string;

const ev = (over: Record<string, unknown>) => ({ sessionId: "s1", event: "tool_start", ...over });

describe("Agentes Claude em tempo real", () => {
  after(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb();
    actor = { userId: (await makeUser("ADMIN", "owner@x.com")).id };
    token = (await createFeed({ name: "Nuvem" }, actor)).token;
  });

  it("autentica pelo token e guarda só o hash", async () => {
    const row = await prisma.agentFeed.findFirstOrThrow();
    assert.notEqual(row.tokenHash, token);
    await assert.rejects(ingestHookEvent("isc_" + "0".repeat(48), ev({})), UnauthorizedLikeError);
    await assert.rejects(ingestHookEvent("x", ev({})), UnauthorizedLikeError);
    const rotated = await rotateFeedToken(row.id, actor);
    await assert.rejects(ingestHookEvent(token, ev({})), UnauthorizedLikeError);
    await ingestHookEvent(rotated.token, ev({}));
  });

  it("rejeita evento inválido", async () => {
    await assert.rejects(ingestHookEvent(token, { sessionId: "s1", event: "inventado" }), ValidationError);
    await assert.rejects(ingestHookEvent(token, { event: "prompt" }), ValidationError);
  });

  it("acompanha o ciclo: trabalhando → erro de ferramenta → aguardando → encerrada", async () => {
    await ingestHookEvent(token, ev({ event: "session_start", repo: "italo/app", branch: "claude/x" }));
    await ingestHookEvent(token, ev({ event: "tool_start", tool: "Edit", target: "src/a.ts" }));
    let [s] = await listActiveSessions();
    assert.equal(s.state, "WORKING");
    assert.equal(s.activity, "Edit · src/a.ts");
    assert.equal(s.repo, "italo/app");

    await ingestHookEvent(token, ev({ event: "tool_end", tool: "Bash", target: "npm test", ok: false }));
    [s] = await listActiveSessions();
    assert.equal(s.state, "ERROR");
    assert.equal(s.failedCount, 1);
    assert.equal(s.toolCount, 1);

    await ingestHookEvent(token, ev({ event: "tool_start", tool: "Edit", target: "src/a.ts" }));
    assert.equal((await listActiveSessions())[0].state, "WORKING");

    await ingestHookEvent(token, ev({ event: "stop" }));
    assert.equal((await listActiveSessions())[0].state, "IDLE");

    await ingestHookEvent(token, ev({ event: "session_end" }));
    assert.equal((await listActiveSessions()).length, 0);
  });

  it("eventos fora de ordem não regridem o estado nem perdem metadados", async () => {
    const t = Date.now();
    // chegam invertidos: o "stop" (mais novo) antes do tool_start e do session_start
    await ingestHookEvent(token, ev({ event: "stop", at: t + 3000 }));
    await ingestHookEvent(token, ev({ event: "tool_start", tool: "Edit", target: "a.ts", at: t + 2000 }));
    await ingestHookEvent(token, ev({ event: "session_start", model: "claude-x", repo: "o/r", at: t + 1000 }));
    const [s] = await listActiveSessions();
    assert.equal(s.state, "IDLE");
    assert.equal(s.model, "claude-x");
    assert.equal(s.repo, "o/r");
  });

  it("histórico guarda resultados e marcos, não cada tool_start", async () => {
    await ingestHookEvent(token, ev({ event: "prompt" }));
    await ingestHookEvent(token, ev({ event: "tool_start", tool: "Read", target: "a.ts" }));
    await ingestHookEvent(token, ev({ event: "tool_end", tool: "Read", target: "a.ts", ok: true }));
    const [s] = await listActiveSessions();
    const { events } = await getSessionTimeline(s.id);
    assert.deepEqual(events.map((e) => e.kind).sort(), ["prompt", "tool_end"]);
  });

  it("sessão sem sinal vira ociosa e depois some", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const base = { phase: "WORKING", lastToolFailed: false };
    assert.equal(deriveAgentState({ ...base, lastEventAt: new Date(now.getTime() - 60_000) }, now), "WORKING");
    assert.equal(deriveAgentState({ ...base, lastEventAt: new Date(now.getTime() - 5 * 60_000) }, now), "IDLE");
    assert.equal(deriveAgentState({ ...base, lastEventAt: new Date(now.getTime() - 40 * 60_000) }, now), "ENDED");
  });

  it("remove segredos dos alvos antes de gravar", async () => {
    assert.ok(!redactSecrets("curl -H 'Authorization: Bearer abcdefgh12345678' x").includes("abcdefgh12345678"));
    assert.ok(!redactSecrets("API_KEY=supersecret123 node a.js").includes("supersecret123"));
    assert.ok(!redactSecrets("git clone https://user:pass123@github.com/a/b").includes("pass123"));
    assert.ok(!redactSecrets("token ghp_abcdefghijklmnop1234").includes("ghp_abcdefghijklmnop1234"));
    await ingestHookEvent(token, ev({ event: "tool_end", tool: "Bash", target: "DB_PASSWORD=hunter2 psql" }));
    const row = await prisma.agentEvent.findFirstOrThrow();
    assert.ok(!row.target?.includes("hunter2"));
  });

  it("poda dados antigos", async () => {
    await ingestHookEvent(token, ev({ event: "prompt" }));
    await prisma.agentSession.updateMany({ data: { lastEventAt: new Date(Date.now() - 4 * 86_400_000) } });
    await prisma.agentEvent.updateMany({ data: { ts: new Date(Date.now() - 4 * 86_400_000) } });
    assert.ok((await pruneAgentData()) >= 1);
    assert.equal(await prisma.agentSession.count(), 0);
  });

  describe("pedidos do painel", () => {
    async function activeSession() {
      await ingestHookEvent(token, ev({ event: "session_start" }));
      return (await listActiveSessions())[0];
    }

    it("entrega o pedido uma única vez, no Stop, e só para quem pede entrega", async () => {
      const s = await activeSession();
      await queueCommand(s.id, { text: "rode os testes" }, actor);
      // evento sem `deliver` apenas sinaliza que há pedido
      const signal = await ingestHookEvent(token, ev({ event: "tool_start", tool: "Edit" }));
      assert.equal(signal.pending, true);
      assert.equal(signal.command, undefined);
      const stop = await ingestHookEvent(token, ev({ event: "stop", deliver: true }));
      assert.match(stop.command ?? "", /rode os testes/);
      assert.match(stop.command ?? "", /painel ID System Universe/);
      const again = await ingestHookEvent(token, ev({ event: "stop", deliver: true }));
      assert.equal(again.command, undefined);
      assert.equal(again.pending, false);
      assert.equal((await listCommands(s.id))[0].status, "DELIVERED");
    });

    it("junta vários pedidos em ordem e entrega no prompt", async () => {
      const s = await activeSession();
      await queueCommand(s.id, { text: "primeiro" }, actor);
      await queueCommand(s.id, { text: "segundo" }, actor);
      const r = await ingestHookEvent(token, ev({ event: "prompt", deliver: true }));
      assert.match(r.command ?? "", /1\. primeiro\n2\. segundo/);
    });

    it("pedido cancelado não é entregue; entregue não cancela", async () => {
      const s = await activeSession();
      const c = await queueCommand(s.id, { text: "cancele-me" }, actor);
      await cancelCommand(s.id, c.id);
      assert.equal((await ingestHookEvent(token, ev({ event: "stop", deliver: true }))).command, undefined);
      const d = await queueCommand(s.id, { text: "entregue" }, actor);
      await ingestHookEvent(token, ev({ event: "stop", deliver: true }));
      await assert.rejects(cancelCommand(s.id, d.id));
    });

    it("não vaza pedido entre sessões", async () => {
      const a = await activeSession();
      await ingestHookEvent(token, ev({ sessionId: "s2", event: "session_start" }));
      await queueCommand(a.id, { text: "só da A" }, actor);
      assert.equal((await ingestHookEvent(token, ev({ sessionId: "s2", event: "stop", deliver: true }))).command, undefined);
      assert.match((await ingestHookEvent(token, ev({ event: "stop", deliver: true }))).command ?? "", /só da A/);
    });

    it("valida texto, limite de fila e sessão encerrada", async () => {
      const s = await activeSession();
      await assert.rejects(queueCommand(s.id, { text: "   " }, actor), ValidationError);
      await assert.rejects(queueCommand(s.id, { text: "x".repeat(2001) }, actor), ValidationError);
      for (let i = 0; i < 5; i++) await queueCommand(s.id, { text: `p${i}` }, actor);
      await assert.rejects(queueCommand(s.id, { text: "sexto" }, actor), ValidationError);
      await ingestHookEvent(token, ev({ event: "session_end" }));
      await assert.rejects(queueCommand(s.id, { text: "tarde demais" }, actor), ValidationError);
    });
  });
});
