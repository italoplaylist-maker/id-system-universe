import { prisma, resetDb, makeUser } from "./helpers";
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { ForbiddenError, RateLimitedError, UnauthorizedLikeError, ValidationError } from "@/lib/errors";
import { requireGlobalScope } from "@/server/auth/project-access";
import { createServer, findServerByToken, getServerMetrics, listServers, rotateServerToken } from "@/server/monitoring/server-service";
import { ingestAgentMetrics } from "@/server/monitoring/ingest";
import { evaluateServerAlerts, pruneOldMetrics } from "@/server/monitoring/alerts";
import { serverStatus } from "@/server/monitoring/thresholds";

let actor: { userId: string };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: "1.0.0",
    hostname: "vps-1",
    os: "Ubuntu 24.04",
    kernel: "6.8",
    cpuModel: "Xeon",
    cpuCores: 4,
    uptimeSec: 3600,
    cpuPercent: 12.5,
    load: [0.4, 0.5, 0.6],
    mem: { totalMb: 8000, usedMb: 2000, swapTotalMb: 1000, swapUsedMb: 10 },
    disk: { totalMb: 100000, usedMb: 40000 },
    net: { rxBps: 1000, txBps: 2000 },
    diskIo: { readBps: 0, writeBps: 500 },
    procs: 150,
    containersTotal: 3,
    containers: [
      { name: "web", cpuPercent: 3.2, memMb: 300, memPercent: 3.7, running: true },
      { name: "db", cpuPercent: 9.1, memMb: 900, memPercent: 11.2, running: true },
      { name: "old", cpuPercent: 0, memMb: 0, memPercent: 0, running: false },
    ],
    ...overrides,
  };
}

async function metricRow(serverId: string, ts: Date, extra: Record<string, number> = {}) {
  return prisma.serverMetric.create({
    data: { serverId, ts, cpuPercent: 10, load1: 0.1, load5: 0.1, load15: 0.1, memUsedMb: 1000, memTotalMb: 8000, diskUsedMb: 10000, diskTotalMb: 100000, procs: 100, containersRunning: 1, containersTotal: 1, uptimeSec: 100, ...extra },
  });
}

describe("Monitoramento de servidores", () => {
  after(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb();
    actor = { userId: (await makeUser("ADMIN", "owner@x.com")).id };
  });

  it("guarda só o hash do token e autentica por ele", async () => {
    const { id, token } = await createServer({ name: "VPS A" }, actor);
    assert.match(token, /^isu_[0-9a-f]{48}$/);
    const row = await prisma.monitoredServer.findUniqueOrThrow({ where: { id } });
    assert.notEqual(row.tokenHash, token);
    assert.equal((await findServerByToken(token)).id, id);
    await assert.rejects(findServerByToken("isu_" + "0".repeat(48)), UnauthorizedLikeError);
    await assert.rejects(findServerByToken("lixo"), UnauthorizedLikeError);
  });

  it("rotacionar o token invalida o anterior", async () => {
    const { id, token } = await createServer({ name: "VPS A" }, actor);
    const rotated = await rotateServerToken(id, actor);
    await assert.rejects(findServerByToken(token), UnauthorizedLikeError);
    assert.equal((await findServerByToken(rotated.token)).id, id);
  });

  it("ingere métricas, atualiza metadados e lista com status e containers", async () => {
    const { id, token } = await createServer({ name: "VPS A" }, actor);
    assert.equal((await listServers())[0].status, "WAITING");
    await ingestAgentMetrics(token, payload());
    const [s] = await listServers();
    assert.equal(s.status, "ONLINE");
    assert.equal(s.hostname, "vps-1");
    assert.equal(s.cpuCores, 4);
    assert.equal(s.latest?.mem.percent, 25);
    assert.equal(s.latest?.disk.percent, 40);
    assert.equal(s.latest?.containersRunning, 2);
    assert.equal(s.latest?.containersTotal, 3);
    // só containers em execução, ordenados pelo mais pesado
    assert.deepEqual(s.containers.map((c) => c.name), ["db", "web"]);
    assert.equal(await prisma.serverMetric.count({ where: { serverId: id } }), 1);
  });

  it("limita a frequência por servidor", async () => {
    const { token } = await createServer({ name: "VPS A" }, actor);
    await ingestAgentMetrics(token, payload());
    await assert.rejects(ingestAgentMetrics(token, payload()), RateLimitedError);
  });

  it("rejeita payload inválido e não grava nada", async () => {
    const { id, token } = await createServer({ name: "VPS A" }, actor);
    await assert.rejects(ingestAgentMetrics(token, payload({ cpuPercent: 250 })), ValidationError);
    // o limite de frequência vale também para envios inválidos, então o segundo caso usa outro servidor
    const other = await createServer({ name: "VPS B" }, actor);
    await assert.rejects(ingestAgentMetrics(other.token, { foo: 1 }), ValidationError);
    assert.equal(await prisma.serverMetric.count({ where: { serverId: id } }), 0);
  });

  it("status derivado do último sinal", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    assert.equal(serverStatus(null, now), "WAITING");
    assert.equal(serverStatus(new Date(now.getTime() - 30_000), now), "ONLINE");
    assert.equal(serverStatus(new Date(now.getTime() - 120_000), now), "OFFLINE");
  });

  it("alerta offline/recuperado apenas na transição", async () => {
    const { id, token } = await createServer({ name: "VPS A" }, actor);
    const old = new Date(Date.now() - 10 * 60_000);
    await prisma.monitoredServer.update({ where: { id }, data: { lastSeenAt: old } });
    await evaluateServerAlerts(id);
    await evaluateServerAlerts(id);
    assert.equal(await prisma.universeEvent.count({ where: { type: "SERVER_OFFLINE" } }), 1);
    await ingestAgentMetrics(token, payload());
    assert.equal(await prisma.universeEvent.count({ where: { type: "SERVER_RECOVERED" } }), 1);
    await evaluateServerAlerts(id);
    assert.equal(await prisma.universeEvent.count({ where: { type: "SERVER_RECOVERED" } }), 1);
  });

  it("CPU crítica usa a média das últimas amostras e alerta uma única vez", async () => {
    const { id } = await createServer({ name: "VPS A" }, actor);
    await prisma.monitoredServer.update({ where: { id }, data: { lastSeenAt: new Date() } });
    const now = Date.now();
    // um pico isolado não alarma
    for (let i = 0; i < 4; i++) await metricRow(id, new Date(now - (10 - i) * 1000), { cpuPercent: 20 });
    await metricRow(id, new Date(now - 1000), { cpuPercent: 100 });
    await evaluateServerAlerts(id);
    assert.equal(await prisma.universeEvent.count({ where: { type: "SERVER_CPU_HIGH" } }), 0);
    // sustentado alarma
    for (let i = 0; i < 5; i++) await metricRow(id, new Date(now + i * 1000), { cpuPercent: 97 });
    await evaluateServerAlerts(id);
    await evaluateServerAlerts(id);
    assert.equal(await prisma.universeEvent.count({ where: { type: "SERVER_CPU_HIGH" } }), 1);
  });

  it("agrega séries em poucos baldes e poda métricas antigas", async () => {
    const { id } = await createServer({ name: "VPS A" }, actor);
    const now = new Date();
    await prisma.serverMetric.createMany({
      data: Array.from({ length: 360 }, (_, i) => ({
        serverId: id, ts: new Date(now.getTime() - i * 10_000), cpuPercent: i % 100, load1: 0.5, load5: 0.5, load15: 0.5, memUsedMb: 2000, memTotalMb: 8000,
        diskUsedMb: 1, diskTotalMb: 10, procs: 1, containersRunning: 0, containersTotal: 0, uptimeSec: 1,
      })),
    });
    const { points, bucketSeconds } = await getServerMetrics(id, "1h", now);
    assert.ok(points.length > 0 && points.length <= 125, `pontos: ${points.length}`);
    assert.equal(bucketSeconds, 30);
    assert.equal(points[0].mem, 25);
    await metricRow(id, new Date(now.getTime() - 8 * 86_400_000));
    assert.equal(await pruneOldMetrics(now), 1);
    assert.equal(await prisma.serverMetric.count({ where: { serverId: id } }), 360);
  });

  it("só quem tem escopo global lê servidores", async () => {
    const project = await prisma.project.create({ data: { name: "P", slug: "p" } });
    const scoped = await makeUser("VIEWER", "v@x.com", [], [project.id]);
    const admin = await makeUser("ADMIN", "a2@x.com");
    await assert.rejects(requireGlobalScope(scoped), ForbiddenError);
    await requireGlobalScope(admin);
  });
});
