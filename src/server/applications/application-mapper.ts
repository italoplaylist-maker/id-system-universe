import type { Application, InfrastructureProvider, Project } from "@prisma/client";
import type { UniverseApplication, UniverseApplicationStatus } from "@/types/domain";

export type ApplicationWithRelations = Application & {
  provider: InfrastructureProvider;
  project?: Project | null;
};

/** Pending operation always resolves to DEPLOYING — regardless of the cached raw status. */
export function effectiveStatusFromRow(row: Pick<Application, "pendingOperation" | "status">): UniverseApplicationStatus {
  if (row.pendingOperation) return "DEPLOYING";
  return row.status as UniverseApplicationStatus;
}

/** The one place an Application row (a "resource", in HQ terms) becomes the shape the API/UI sees. */
export function toUniverseApplication(row: ApplicationWithRelations): UniverseApplication {
  return {
    id: row.id,
    externalId: row.externalId,
    providerId: row.providerId,
    providerType: row.provider.type,
    providerName: row.provider.name,
    providerColor: row.provider.color,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    projectAccent: row.project?.accent ?? null,
    resourceType: row.resourceType,
    name: row.name,
    description: row.description,
    status: effectiveStatusFromRow(row),
    fqdn: row.fqdn,
    repository: row.repository,
    branch: row.branch,
    lastDeployedAt: row.lastDeployedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    pendingOperation: row.pendingOperation,
  };
}
