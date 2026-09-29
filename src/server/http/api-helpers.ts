import { NextResponse } from "next/server";
import { toClientError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { can, type Permission } from "@/server/auth/rbac";
import type { SessionUser } from "@/server/auth/session";

export function apiError(error: unknown): NextResponse {
  const { message, statusCode, code } = toClientError(error);
  if (statusCode >= 500) {
    logger.error("api_error", { message, code, statusCode, stack: error instanceof Error ? error.stack : undefined });
  }
  return NextResponse.json({ error: message, code }, { status: statusCode });
}

export function requirePermission(user: SessionUser, permission: Permission): void {
  if (!can(user.role, permission)) {
    throw new ForbiddenError();
  }
}
