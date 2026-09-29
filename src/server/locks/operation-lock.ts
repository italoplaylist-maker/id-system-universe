import { prisma } from "@/server/db/client";
import { ConflictError } from "@/lib/errors";

/** A lock older than this is considered abandoned (crashed request, etc.) and can be reclaimed. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export type PendingOperation = "START" | "STOP" | "RESTART" | "REDEPLOY" | "FORCE_REDEPLOY";

/**
 * Persisted, conditional-update lock — not in-memory — so it survives
 * process restarts and works correctly even if this ever runs behind more
 * than one Node process. Two concurrent requests racing to lock the same
 * application will have exactly one `updateMany` match.
 */
export async function acquireOperationLock(applicationId: string, operation: PendingOperation, applicationName: string): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS);

  const result = await prisma.application.updateMany({
    where: {
      id: applicationId,
      OR: [{ pendingOperation: null }, { pendingSince: { lt: staleThreshold } }],
    },
    data: { pendingOperation: operation, pendingSince: new Date(), pendingDeploymentExternalId: null },
  });

  if (result.count === 0) {
    throw new ConflictError(`${applicationName} already has an operation in progress.`);
  }
}

export async function releaseOperationLock(applicationId: string, deploymentExternalId?: string): Promise<void> {
  await prisma.application.update({
    where: { id: applicationId },
    data: {
      pendingOperation: deploymentExternalId ? undefined : null,
      pendingSince: deploymentExternalId ? undefined : null,
      pendingDeploymentExternalId: deploymentExternalId ?? null,
    },
  });
}

export async function clearOperationLock(applicationId: string): Promise<void> {
  await prisma.application.update({
    where: { id: applicationId },
    data: { pendingOperation: null, pendingSince: null, pendingDeploymentExternalId: null },
  });
}
