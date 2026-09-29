import { prisma } from "@/server/db/client";

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
  | "RESOURCE_UNASSIGNED";

export interface RecordUniverseEventInput {
  type: UniverseEventType;
  message: string;
  applicationId?: string;
  applicationName?: string;
  providerId?: string;
  projectId?: string | null;
  projectName?: string | null;
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
    },
  });
}

export async function listRecentUniverseEvents(limit = 50, projectId?: string) {
  return prisma.universeEvent.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
