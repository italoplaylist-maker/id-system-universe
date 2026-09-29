import { z } from "zod";
import { prisma } from "@/server/db/client";
import { encryptSecret } from "@/server/crypto/encryption";
import { validateProviderBaseUrl } from "@/server/security/ssrf";
import { createDeploymentProvider } from "@/server/providers/provider-registry";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { InfrastructureProvider } from "@prisma/client";

const FAILURES_BEFORE_OFFLINE = 3;

export const createProviderSchema = z.object({
  name: z.string().min(1).max(80),
  baseUrl: z.string().min(1),
  token: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  token: z.string().min(1).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  enabled: z.boolean().optional(),
});

/** Never includes encryptedToken — this is the shape the browser is allowed to see. */
export interface SanitizedProvider {
  id: string;
  type: InfrastructureProvider["type"];
  name: string;
  baseUrl: string;
  maskedToken: string;
  enabled: boolean;
  color: string;
  health: InfrastructureProvider["health"];
  latencyMs: number | null;
  lastCheckAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  applicationCount: number;
  projectCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function sanitize(row: InfrastructureProvider & { _count?: { applications: number } }, projectCount = 0): SanitizedProvider {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    maskedToken: "••••••••" + row.id.slice(-4),
    enabled: row.enabled,
    color: row.color,
    health: row.health,
    latencyMs: row.latencyMs,
    lastCheckAt: row.lastCheckAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    applicationCount: row._count?.applications ?? 0,
    projectCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProviders(): Promise<SanitizedProvider[]> {
  const rows = await prisma.infrastructureProvider.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { applications: true } } },
  });

  const projectLinks = await prisma.application.findMany({
    where: { providerId: { in: rows.map((r) => r.id) }, projectId: { not: null } },
    select: { providerId: true, projectId: true },
    distinct: ["providerId", "projectId"],
  });
  const projectCounts = new Map<string, number>();
  for (const link of projectLinks) {
    projectCounts.set(link.providerId, (projectCounts.get(link.providerId) ?? 0) + 1);
  }

  return rows.map((row) => sanitize(row, projectCounts.get(row.id) ?? 0));
}

export async function getProviderRowOrThrow(id: string) {
  const row = await prisma.infrastructureProvider.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Provider not found.");
  return row;
}

export async function createProvider(
  input: unknown,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<SanitizedProvider> {
  const parsed = createProviderSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const { normalizedBaseUrl } = await validateProviderBaseUrl(parsed.data.baseUrl);

  const row = await prisma.infrastructureProvider.create({
    data: {
      name: parsed.data.name,
      baseUrl: normalizedBaseUrl,
      encryptedToken: encryptSecret(parsed.data.token),
      color: parsed.data.color ?? "#38bdf8",
    },
  });

  await recordAuditEvent({
    userId: actor.userId,
    providerId: row.id,
    action: "PROVIDER_CREATED",
    status: "SUCCESS",
    metadata: { name: row.name, baseUrl: row.baseUrl },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return sanitize({ ...row, _count: { applications: 0 } });
}

export async function updateProvider(
  id: string,
  input: unknown,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<SanitizedProvider> {
  const existing = await getProviderRowOrThrow(id);
  const parsed = updateProviderSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const row = await prisma.infrastructureProvider.update({
    where: { id },
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      enabled: parsed.data.enabled,
      encryptedToken: parsed.data.token ? encryptSecret(parsed.data.token) : undefined,
    },
    include: { _count: { select: { applications: true } } },
  });

  await recordAuditEvent({
    userId: actor.userId,
    providerId: row.id,
    action: "PROVIDER_UPDATED",
    status: "SUCCESS",
    metadata: { changedFields: Object.keys(parsed.data), previousName: existing.name },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return sanitize(row);
}

export async function deleteProvider(id: string, actor: { userId: string; ip?: string; userAgent?: string }): Promise<void> {
  const existing = await getProviderRowOrThrow(id);
  await prisma.infrastructureProvider.delete({ where: { id } });
  await recordAuditEvent({
    userId: actor.userId,
    action: "PROVIDER_DELETED",
    status: "SUCCESS",
    metadata: { name: existing.name, baseUrl: existing.baseUrl },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

export async function testProviderConnection(
  id: string,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<{ ok: boolean; latencyMs: number; applicationCount?: number; error?: string }> {
  const row = await getProviderRowOrThrow(id);
  const provider = createDeploymentProvider(row);
  const result = await provider.testConnection();

  const wasOffline = row.health === "OFFLINE";
  const consecutiveFailures = result.ok ? 0 : row.consecutiveFailures + 1;
  const health = result.ok
    ? "ONLINE"
    : consecutiveFailures >= FAILURES_BEFORE_OFFLINE
      ? "OFFLINE"
      : "DEGRADED";

  await prisma.infrastructureProvider.update({
    where: { id },
    data: {
      health,
      latencyMs: result.latencyMs,
      lastCheckAt: new Date(),
      lastSuccessAt: result.ok ? new Date() : undefined,
      lastError: result.ok ? null : (result.error ?? "Unknown error"),
      consecutiveFailures,
    },
  });

  if (!result.ok && health === "OFFLINE" && !wasOffline) {
    await recordUniverseEvent({
      type: "PROVIDER_CONNECTION_FAILED",
      message: `${row.name} connection failed: ${result.error ?? "unknown error"}`,
      providerId: row.id,
    });
    logger.warn("provider_offline", { providerId: row.id, providerName: row.name });
  }
  if (result.ok && wasOffline) {
    await recordUniverseEvent({
      type: "PROVIDER_CONNECTION_RESTORED",
      message: `${row.name} connection restored.`,
      providerId: row.id,
    });
  }

  await recordAuditEvent({
    userId: actor.userId,
    providerId: id,
    action: "PROVIDER_CONNECTION_TEST",
    status: result.ok ? "SUCCESS" : "FAILED",
    metadata: { latencyMs: result.latencyMs, applicationCount: result.applicationCount },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return result;
}

const dryRunSchema = z.object({ baseUrl: z.string().min(1), token: z.string().min(1) });

/**
 * Validates a Coolify connection WITHOUT persisting anything — used by the
 * "TEST CONNECTION" button before the user commits to saving a provider.
 * Nothing here touches the database.
 */
export async function testConnectionDryRun(
  input: unknown,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<{ ok: boolean; latencyMs: number; applicationCount?: number; error?: string }> {
  const parsed = dryRunSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const { normalizedBaseUrl } = await validateProviderBaseUrl(parsed.data.baseUrl);
  const provider = createDeploymentProvider({
    type: "COOLIFY",
    baseUrl: normalizedBaseUrl,
    encryptedToken: encryptSecret(parsed.data.token),
    name: "New provider",
  });
  const result = await provider.testConnection();

  await recordAuditEvent({
    userId: actor.userId,
    action: "PROVIDER_CONNECTION_TEST",
    status: result.ok ? "SUCCESS" : "FAILED",
    metadata: { baseUrl: normalizedBaseUrl, dryRun: true },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return result;
}
