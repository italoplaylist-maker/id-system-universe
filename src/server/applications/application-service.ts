import { prisma } from "@/server/db/client";
import { createDeploymentProvider } from "@/server/providers/provider-registry";
import { getProviderRowOrThrow } from "@/server/providers/provider-service";
import { acquireOperationLock, clearOperationLock, type PendingOperation } from "@/server/locks/operation-lock";
import { recordAuditEvent, type AuditAction } from "@/server/audit/audit-log";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { TtlCache } from "@/server/cache/cache";
import { NotFoundError, ProviderError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { toUniverseApplication, type ApplicationWithRelations } from "@/server/applications/application-mapper";
import { linkUnassignedResourcesFromProviderProjects } from "@/server/projects/project-service";
import type { UniverseApplication, UniverseApplicationStatus } from "@/types/domain";

type ApplicationWithProvider = ApplicationWithRelations;

const STATUS_CACHE_TTL_MS = 5_000;
const statusCache = new TtlCache<UniverseApplicationStatus>(STATUS_CACHE_TTL_MS);

export interface ActorContext {
  userId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Pulls the current application list from one provider and upserts it into
 * the cache table. Coolify stays the source of truth — this cache only
 * exists so the UI and search don't hit every provider on every render.
 */
export async function syncProviderApplications(providerId: string): Promise<{ synced: number; error?: string }> {
  const providerRow = await getProviderRowOrThrow(providerId);
  if (!providerRow.enabled) return { synced: 0 };

  try {
    const provider = createDeploymentProvider(providerRow);
    const remoteApps = await provider.listResources();

    for (const remote of remoteApps) {
      await prisma.application.upsert({
        where: { providerId_externalId: { providerId, externalId: remote.externalId } },
        create: {
          providerId,
          externalId: remote.externalId,
          resourceType: remote.resourceType,
          groupExternalId: remote.groupExternalId,
          name: remote.name,
          description: remote.description,
          status: remote.status,
          fqdn: remote.fqdn,
          repository: remote.repository,
          branch: remote.branch,
        },
        update: {
          name: remote.name,
          description: remote.description,
          // Never downgrade a freshly-known DEPLOYING state from an in-flight
          // action just because a sync raced in in the meantime.
          status: remote.status,
          fqdn: remote.fqdn,
          repository: remote.repository,
          branch: remote.branch,
          resourceType: remote.resourceType,
          groupExternalId: remote.groupExternalId,
          lastSyncedAt: new Date(),
        },
      });
    }

    const remoteIds = new Set(remoteApps.map((a) => a.externalId));
    const existing = await prisma.application.findMany({ where: { providerId }, select: { id: true, externalId: true } });
    const removedIds = existing.filter((e) => !remoteIds.has(e.externalId)).map((e) => e.id);
    if (removedIds.length > 0) {
      await prisma.application.deleteMany({ where: { id: { in: removedIds } } });
    }

    // Auto-link resources to the project this provider already groups them
    // under (e.g. Coolify's own Projects) — best-effort: a provider without a
    // project concept, or one whose project endpoints fail, just skips this
    // without failing the application sync that already succeeded above.
    try {
      const remoteProjects = await provider.listProjects();
      await linkUnassignedResourcesFromProviderProjects(providerId, remoteProjects);
    } catch (error) {
      logger.warn("provider_project_sync_failed", { providerId, message: error instanceof Error ? error.message : String(error) });
    }

    return { synced: remoteApps.length };
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : "Sync failed.";
    logger.error("provider_sync_failed", { providerId, message });
    return { synced: 0, error: message };
  }
}

export async function syncAllProviders(): Promise<void> {
  const providers = await prisma.infrastructureProvider.findMany({ where: { enabled: true } });
  await Promise.all(providers.map((p) => syncProviderApplications(p.id)));
  await recordUniverseEvent({ type: "SYNC_COMPLETED", message: `Synced ${providers.length} provider(s).` });

  // Diagnostic summary — cheap (a handful of counts), never logs secrets, and
  // is the fastest way to tell "no Projects because none exist yet" apart
  // from "no Projects because something upstream is silently failing," and
  // "no Services/Databases because there are none" apart from "sync isn't
  // discovering them" (the exact class of bug this summary is here for).
  const [projectCount, resourceCount, unassignedCount, byType] = await Promise.all([
    prisma.project.count(),
    prisma.application.count(),
    prisma.application.count({ where: { projectId: null } }),
    prisma.application.groupBy({ by: ["resourceType"], _count: true }),
  ]);
  logger.info("universe_sync_summary", {
    providers: providers.length,
    projects: projectCount,
    resources: resourceCount,
    assigned: resourceCount - unassignedCount,
    unassigned: unassignedCount,
    byType: Object.fromEntries(byType.map((row) => [row.resourceType, row._count])),
  });
}

export interface ListApplicationsFilter {
  providerId?: string;
  projectId?: string;
  /** True to list only resources with no project assigned yet. */
  unassignedOnly?: boolean;
  query?: string;
  status?: UniverseApplicationStatus;
}

export async function listApplications(filter: ListApplicationsFilter = {}): Promise<UniverseApplication[]> {
  const rows = await prisma.application.findMany({
    where: {
      providerId: filter.providerId,
      projectId: filter.unassignedOnly ? null : filter.projectId,
      ...(filter.query
        ? {
            OR: [
              { name: { contains: filter.query, mode: "insensitive" } },
              { repository: { contains: filter.query, mode: "insensitive" } },
              { branch: { contains: filter.query, mode: "insensitive" } },
              { fqdn: { contains: filter.query, mode: "insensitive" } },
              { provider: { name: { contains: filter.query, mode: "insensitive" } } },
              { project: { name: { contains: filter.query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { provider: true, project: true },
    orderBy: { name: "asc" },
  });

  const mapped = rows.map((row) => toUniverseApplication(row));
  return filter.status ? mapped.filter((a) => a.status === filter.status) : mapped;
}

async function getRowOrThrow(applicationId: string): Promise<ApplicationWithProvider> {
  const row = await prisma.application.findUnique({ where: { id: applicationId }, include: { provider: true, project: true } });
  if (!row) throw new NotFoundError("Application not found.");
  return row;
}

/**
 * The one place that reconciles a known in-flight deployment against the
 * provider's real state. Called from status/detail reads rather than a
 * background timer — the frontend drives the polling cadence (fast while a
 * panel is open, idle otherwise), and every read gets a consistent picture.
 */
async function reconcilePendingDeployment(row: ApplicationWithProvider): Promise<ApplicationWithProvider> {
  if (!row.pendingDeploymentExternalId) return row;

  const cacheKey = `deployment:${row.pendingDeploymentExternalId}`;
  const cached = statusCache.get(cacheKey);
  if (cached) return row;

  try {
    const provider = createDeploymentProvider(row.provider);
    const deployment = await provider.getDeployment(row.pendingDeploymentExternalId);
    statusCache.set(cacheKey, "UNKNOWN");

    if (deployment.status === "SUCCESS" || deployment.status === "FAILED" || deployment.status === "CANCELLED") {
      const finalStatus: UniverseApplicationStatus = deployment.status === "SUCCESS" ? "RUNNING" : "ERROR";
      const updated = await prisma.application.update({
        where: { id: row.id },
        data: { status: finalStatus, pendingOperation: null, pendingSince: null, pendingDeploymentExternalId: null, lastDeployedAt: new Date() },
        include: { provider: true, project: true },
      });

      await recordAuditEvent({
        applicationId: row.id,
        providerId: row.providerId,
        projectId: row.projectId,
        action: row.pendingOperation === "FORCE_REDEPLOY" ? "APPLICATION_FORCE_REDEPLOY" : "APPLICATION_REDEPLOY",
        status: deployment.status === "SUCCESS" ? "SUCCESS" : "FAILED",
        metadata: { deploymentId: row.pendingDeploymentExternalId },
      });
      await recordUniverseEvent({
        type: deployment.status === "SUCCESS" ? "DEPLOYMENT_COMPLETED" : "DEPLOYMENT_FAILED",
        message: `${row.project ? `${row.project.name} / ` : ""}${row.name} deployment ${deployment.status === "SUCCESS" ? "completed" : "failed"}.`,
        applicationId: row.id,
        applicationName: row.name,
        providerId: row.providerId,
        projectId: row.projectId,
        projectName: row.project?.name,
      });

      return updated;
    }
  } catch (error) {
    logger.warn("deployment_reconcile_failed", { applicationId: row.id, error: error instanceof Error ? error.message : String(error) });
  }

  return row;
}

export async function getApplicationDetail(applicationId: string): Promise<UniverseApplication> {
  let row = await getRowOrThrow(applicationId);
  row = await reconcilePendingDeployment(row);
  return toUniverseApplication(row);
}

const ACTION_TO_AUDIT: Record<PendingOperation, AuditAction> = {
  START: "APPLICATION_START",
  STOP: "APPLICATION_STOP",
  RESTART: "APPLICATION_RESTART",
  REDEPLOY: "APPLICATION_REDEPLOY",
  FORCE_REDEPLOY: "APPLICATION_FORCE_REDEPLOY",
};

/** "Project / Resource" when the resource is assigned, just "Resource" when unassigned. */
function eventLabel(row: Pick<ApplicationWithProvider, "name" | "project">): string {
  return row.project ? `${row.project.name} / ${row.name}` : row.name;
}

async function runImmediateAction(
  row: ApplicationWithProvider,
  operation: "START" | "STOP" | "RESTART",
  actor: ActorContext,
): Promise<UniverseApplication> {
  await acquireOperationLock(row.id, operation, row.name);
  await recordAuditEvent({ userId: actor.userId, applicationId: row.id, providerId: row.providerId, projectId: row.projectId, action: ACTION_TO_AUDIT[operation], status: "REQUESTED", ipAddress: actor.ip, userAgent: actor.userAgent });
  await recordUniverseEvent({
    type: operation === "START" ? "START_REQUESTED" : operation === "STOP" ? "STOP_REQUESTED" : "RESTART_REQUESTED",
    message: `${eventLabel(row)} ${operation.toLowerCase()} requested.`,
    applicationId: row.id,
    applicationName: row.name,
    providerId: row.providerId,
    projectId: row.projectId,
    projectName: row.project?.name,
  });

  try {
    const provider = createDeploymentProvider(row.provider);
    if (operation === "START") await provider.startApplication(row.externalId, row.resourceType);
    else if (operation === "STOP") await provider.stopApplication(row.externalId, row.resourceType);
    else await provider.restartApplication(row.externalId, row.resourceType);

    const liveStatus = await provider.getApplicationStatus(row.externalId, row.resourceType);
    const updated = await prisma.application.update({
      where: { id: row.id },
      data: { status: liveStatus, pendingOperation: null, pendingSince: null },
      include: { provider: true, project: true },
    });

    await recordAuditEvent({ userId: actor.userId, applicationId: row.id, providerId: row.providerId, projectId: row.projectId, action: ACTION_TO_AUDIT[operation], status: "SUCCESS", ipAddress: actor.ip, userAgent: actor.userAgent });
    if (operation === "RESTART") {
      await recordUniverseEvent({ type: "RESTART_COMPLETED", message: `${eventLabel(row)} restarted.`, applicationId: row.id, applicationName: row.name, providerId: row.providerId, projectId: row.projectId, projectName: row.project?.name });
    }

    return toUniverseApplication(updated);
  } catch (error) {
    await clearOperationLock(row.id);
    await recordAuditEvent({
      userId: actor.userId,
      applicationId: row.id,
      providerId: row.providerId,
      projectId: row.projectId,
      action: ACTION_TO_AUDIT[operation],
      status: "FAILED",
      metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    throw error;
  }
}

export async function startApplication(applicationId: string, actor: ActorContext) {
  return runImmediateAction(await getRowOrThrow(applicationId), "START", actor);
}

export async function stopApplication(applicationId: string, actor: ActorContext) {
  return runImmediateAction(await getRowOrThrow(applicationId), "STOP", actor);
}

export async function restartApplication(applicationId: string, actor: ActorContext) {
  return runImmediateAction(await getRowOrThrow(applicationId), "RESTART", actor);
}

export async function redeployApplication(applicationId: string, force: boolean, actor: ActorContext): Promise<UniverseApplication> {
  const row = await getRowOrThrow(applicationId);
  // Only a git-deployed Application has a build/deploy history — a Service
  // or Database is "redeployed" by restarting it (see restartApplication).
  if (row.resourceType !== "APPLICATION") throw new ValidationError("Only applications support redeploy.");
  const operation: PendingOperation = force ? "FORCE_REDEPLOY" : "REDEPLOY";

  await acquireOperationLock(row.id, operation, row.name);
  await recordAuditEvent({ userId: actor.userId, applicationId: row.id, providerId: row.providerId, projectId: row.projectId, action: ACTION_TO_AUDIT[operation], status: "REQUESTED", ipAddress: actor.ip, userAgent: actor.userAgent });
  await recordUniverseEvent({ type: "REDEPLOY_REQUESTED", message: `${eventLabel(row)} redeploy requested${force ? " (no cache)" : ""}.`, applicationId: row.id, applicationName: row.name, providerId: row.providerId, projectId: row.projectId, projectName: row.project?.name });

  try {
    const provider = createDeploymentProvider(row.provider);
    const result = await provider.redeployApplication(row.externalId, { force });

    const updated = await prisma.application.update({
      where: { id: row.id },
      data: { status: "DEPLOYING", pendingDeploymentExternalId: result.deploymentExternalId },
      include: { provider: true, project: true },
    });

    await recordAuditEvent({ userId: actor.userId, applicationId: row.id, providerId: row.providerId, projectId: row.projectId, action: ACTION_TO_AUDIT[operation], status: "RUNNING", metadata: { deploymentId: result.deploymentExternalId }, ipAddress: actor.ip, userAgent: actor.userAgent });
    await recordUniverseEvent({ type: "DEPLOYMENT_STARTED", message: `${eventLabel(row)} deployment started.`, applicationId: row.id, applicationName: row.name, providerId: row.providerId, projectId: row.projectId, projectName: row.project?.name });

    return toUniverseApplication(updated);
  } catch (error) {
    await clearOperationLock(row.id);
    await recordAuditEvent({
      userId: actor.userId,
      applicationId: row.id,
      providerId: row.providerId,
      projectId: row.projectId,
      action: ACTION_TO_AUDIT[operation],
      status: "FAILED",
      metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    throw error;
  }
}

export async function getApplicationLogs(applicationId: string, lines: number) {
  const row = await getRowOrThrow(applicationId);
  const provider = createDeploymentProvider(row.provider);
  return provider.getApplicationLogs(row.externalId, row.resourceType, { lines });
}

export async function listApplicationDeployments(applicationId: string) {
  const row = await getRowOrThrow(applicationId);
  if (row.resourceType !== "APPLICATION") throw new ValidationError("Only applications have a deployment history.");
  const provider = createDeploymentProvider(row.provider);
  return provider.listDeployments(row.externalId);
}
