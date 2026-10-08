import { NextResponse } from "next/server";
import { toClientError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { canUser, type Permission } from "@/server/auth/rbac";
import { requireSessionUser, getRequestMeta, type SessionUser } from "@/server/auth/session";

export function apiError(error: unknown): NextResponse {
  const { message, statusCode, code } = toClientError(error);
  if (statusCode >= 500) {
    logger.error("api_error", { message, code, statusCode, stack: error instanceof Error ? error.stack : undefined });
  }
  return NextResponse.json({ error: message, code }, { status: statusCode });
}

export function requirePermission(user: SessionUser, permission: Permission): void {
  if (!canUser(user, permission)) {
    throw new ForbiddenError();
  }
}

/** Sessão + permissão em uma chamada — o início de toda rota autenticada. */
export async function authorize(permission: Permission): Promise<SessionUser> {
  const user = await requireSessionUser();
  requirePermission(user, permission);
  return user;
}

export async function actorFor(user: SessionUser) {
  const meta = await getRequestMeta();
  return { userId: user.id, ip: meta.ip, userAgent: meta.userAgent };
}

/** Lê o corpo JSON sem derrubar a rota com SyntaxError (corpo vazio vira {}). */
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}
