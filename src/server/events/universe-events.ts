import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { canUser, type PermissionSubject } from "@/server/auth/rbac";
import type { ProjectScope } from "@/server/auth/project-access";

export type UniverseEventType =
  | "REDEPLOY_REQUESTED"
  | "DEPLOYMENT_STARTED"
  | "DEPLOYMENT_COMPLETED"
  | "DEPLOYMENT_FAILED"
  | "RESTART_REQUESTED"
  | "RESTART_COMPLETED"
  | "STOP_REQUESTED"
  | "START_REQUESTED"
  | "APPLICATION_RUNNING"
  | "APPLICATION_ERROR"
  | "PROVIDER_CONNECTION_FAILED"
  | "PROVIDER_CONNECTION_RESTORED"
  | "SYNC_COMPLETED"
  | "RESOURCE_ASSIGNED"
  | "RESOURCE_UNASSIGNED"
  | "PROJECT_AUTO_CREATED"
  | "GITHUB_CONNECTED"
  | "GITHUB_DISCONNECTED"
  | "GITHUB_DEPLOY_QUEUED"
  | "BILLING_DUE_TODAY"
  | "BILLING_OVERDUE"
  | "BILLING_CLIENT_WITHOUT_WHATSAPP"
  | "BILLING_RECURRENCE_ERROR"
  | "WHATSAPP_FAILED"
  | "SERVER_OFFLINE"
  | "SERVER_RECOVERED"
  | "SERVER_CPU_HIGH"
  | "SERVER_MEM_HIGH"
  | "SERVER_DISK_HIGH";

export interface RecordUniverseEventInput {
  type: UniverseEventType;
  message: string;
  applicationId?: string;
  applicationName?: string;
  providerId?: string;
  projectId?: string | null;
  projectName?: string | null;
  /** Só quem tem esta permissão enxerga o evento (ex.: "billing:view"). */
  permission?: string;
}

export async function recordUniverseEvent(input: RecordUniverseEventInput): Promise<void> {
  await prisma.universeEvent.create({
    data: {
      type: input.type,
      message: input.message,
      applicationId: input.applicationId,
      applicationName: input.applicationName,
      providerId: input.providerId,
      projectId: input.projectId,
      projectName: input.projectName,
      permission: input.permission,
    },
  });
}

export async function listRecentUniverseEvents(
  limit = 50,
  options: { projectId?: string; scope?: ProjectScope; user?: PermissionSubject } = {},
) {
  const { projectId, scope, user } = options;
  const projectFilter: Prisma.UniverseEventWhereInput = projectId
    ? { projectId }
    : scope && !scope.all
      ? { projectId: { in: scope.projectIds } }
      : {};
  // Eventos protegidos por permissão (financeiro) nunca vazam para quem não a possui.
  const permissionFilter: Prisma.UniverseEventWhereInput = {
    OR: [
      { permission: null },
      ...(user && canUser(user, "billing:view") ? [{ permission: "billing:view" }] : []),
    ],
  };
  return prisma.universeEvent.findMany({
    where: { AND: [projectFilter, permissionFilter] },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
