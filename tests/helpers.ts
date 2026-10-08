/**
 * IMPORTANTE: este módulo precisa ser o PRIMEIRO import de cada teste — ele aponta
 * o Prisma para o banco de testes antes de qualquer código do app carregar.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url || !/test/i.test(url)) {
  throw new Error("Defina TEST_DATABASE_URL apontando para um banco de dados DEDICADO a testes (o nome deve conter 'test').");
}
process.env.DATABASE_URL = url;
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
(process.env as Record<string, string>).NODE_ENV ??= "test";

import http from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";

export { prisma };

const KEEP = new Set(["_prisma_migrations", "BillingTemplate", "BillingReason"]);

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = tables.map((t) => t.tablename).filter((t) => !KEEP.has(t));
  if (names.length > 0) await prisma.$executeRawUnsafe(`TRUNCATE ${names.map((n) => `"${n}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function makeUser(role: SessionUser["role"], email: string, extraPermissions: string[] = [], projectIds: string[] = []): Promise<SessionUser> {
  const user = await prisma.user.create({ data: { email, passwordHash: "x", role, extraPermissions } });
  if (projectIds.length > 0) await prisma.projectAccess.createMany({ data: projectIds.map((projectId) => ({ userId: user.id, projectId })) });
  return { id: user.id, email, role, extraPermissions };
}

export interface MockServer {
  url: string;
  close(): Promise<void>;
}

export function startServer(handler: http.RequestListener): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export interface MockEvolution extends MockServer {
  sent: { phone: string; text: string }[];
  mode: { value: "ok" | "500" | "400" };
}

export async function startMockEvolution(): Promise<MockEvolution> {
  const sent: { phone: string; text: string }[] = [];
  const mode = { value: "ok" as "ok" | "500" | "400" };
  const server = await startServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url?.startsWith("/message/sendText/") && req.method === "POST") {
      if (mode.value === "500") { res.statusCode = 500; res.end("boom"); return; }
      if (mode.value === "400") { res.statusCode = 400; res.end("bad number"); return; }
      const parsed = JSON.parse(body) as { number: string; text: string };
      sent.push({ phone: parsed.number, text: parsed.text });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ key: { id: `msg-${sent.length}` } }));
      return;
    }
    if (req.url?.startsWith("/instance/connectionState/")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ instance: { state: "open" } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return Object.assign(server, { sent, mode });
}

export interface MockCoolify extends MockServer {
  deploys: string[];
  /** status devolvido por GET /deployments/:id (por padrão "in_progress"). */
  deploymentStatus: Record<string, string>;
  deploymentCommit: Record<string, string>;
}

export async function startMockCoolify(): Promise<MockCoolify> {
  const deploys: string[] = [];
  const deploymentStatus: Record<string, string> = {};
  const deploymentCommit: Record<string, string> = {};
  const server = await startServer(async (req, res) => {
    await readBody(req);
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/api/v1/deploy" && req.method === "POST") {
      const id = `dep-${deploys.length + 1}`;
      deploys.push(id);
      deploymentStatus[id] = "in_progress";
      res.end(JSON.stringify({ deployments: [{ resource_uuid: url.searchParams.get("uuid"), deployment_uuid: id, message: "queued" }] }));
      return;
    }
    const match = /^\/api\/v1\/deployments\/([^/]+)$/.exec(url.pathname);
    if (match) {
      res.end(JSON.stringify({ deployment_uuid: match[1], status: deploymentStatus[match[1]] ?? "in_progress", commit: deploymentCommit[match[1]] ?? null }));
      return;
    }
    if (/^\/api\/v1\/applications\/[^/]+$/.test(url.pathname)) {
      res.end(JSON.stringify({ uuid: "x", status: "running:healthy" }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return Object.assign(server, { deploys, deploymentStatus, deploymentCommit });
}
