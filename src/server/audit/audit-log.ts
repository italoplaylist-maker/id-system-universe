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
  | "USER_PASSWORD_RESET";

export type AuditStatus = "REQUESTED" | "RUNNING" | "SUCCESS" | "FAILED";

export interface RecordAuditEventInput {
  userId?: string;
  providerId?: string;
  applicationId?: string;
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
      action: input.action,
      status: input.status,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}
