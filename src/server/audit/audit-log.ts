import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "APPLICATION_START"
  | "APPLICATION_STOP"
  | "APPLICATION_RESTART"
  | "APPLICATION_REDEPLOY"
  | "APPLICATION_FORCE_REDEPLOY"
  | "PROVIDER_CREATED"
  | "PROVIDER_UPDATED"
  | "PROVIDER_DELETED"
  | "PROVIDER_CONNECTION_TEST"
  | "AUTH_LOGIN"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "AUTH_BOOTSTRAP"
  | "USER_CREATED"
  | "USER_ROLE_CHANGED"
  | "USER_DEACTIVATED"
  | "USER_REACTIVATED"
  | "USER_PASSWORD_RESET"
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_ARCHIVED"
  | "PROJECT_UNARCHIVED"
  | "PROJECT_DELETED"
  | "RESOURCE_ASSIGNED"
  | "RESOURCE_UNASSIGNED"
  | "USER_PROJECT_ACCESS_CHANGED"
  | "USER_PERMISSIONS_CHANGED"
  | "GITHUB_INSTALLATION_CONNECTED"
  | "GITHUB_INSTALLATION_REMOVED"
  | "GITHUB_CONFIG_UPDATED"
  | "RESOURCE_REPOSITORY_LINKED"
  | "RESOURCE_REPOSITORY_UNLINKED"
  | "GITHUB_AUTO_DEPLOY"
  | "WHATSAPP_CONFIG_UPDATED"
  | "CLIENT_CREATED"
  | "CLIENT_UPDATED"
  | "CHARGE_CREATED"
  | "CHARGE_UPDATED"
  | "CHARGE_AMOUNT_CHANGED"
  | "CHARGE_DUE_DATE_CHANGED"
  | "CHARGE_PAID"
  | "CHARGE_PAYMENT_REVERSED"
  | "CHARGE_CANCELLED"
  | "RECURRENCE_CREATED"
  | "RECURRENCE_UPDATED"
  | "RECURRENCE_PAUSED"
  | "RECURRENCE_RESUMED"
  | "RECURRENCE_ENDED"
  | "WHATSAPP_MESSAGE_SENT"
  | "WHATSAPP_MESSAGE_FAILED"
  | "WHATSAPP_MANUAL_SEND"
  | "BILLING_TEMPLATE_UPDATED"
  | "SERVER_CREATED"
  | "SERVER_DELETED"
  | "SERVER_TOKEN_ROTATED"
  | "AGENT_FEED_CREATED"
  | "AGENT_FEED_DELETED"
  | "AGENT_FEED_TOKEN_ROTATED";

export type AuditStatus = "REQUESTED" | "RUNNING" | "SUCCESS" | "FAILED";

export interface RecordAuditEventInput {
  userId?: string;
  providerId?: string;
  applicationId?: string;
  projectId?: string | null;
  entityType?: string;
  entityId?: string;
  action: AuditAction;
  status: AuditStatus;
  /** Must already be sanitized — never pass tokens, headers, or secrets here. */
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      userId: input.userId,
      providerId: input.providerId,
      applicationId: input.applicationId,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      status: input.status,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}
