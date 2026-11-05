import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { submitClaudeLoginCode } from "@/server/orchestrator/claude-auth";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await guard(true);
    consumeRateLimit(`claude-login-code:${user.id}`, 10, 10 * 60_000);
    const body = (await readJson(request)) as { code?: unknown };
    if (typeof body.code !== "string") throw new ValidationError("Cole o código mostrado pelo Claude.");
    await submitClaudeLoginCode(body.code); // o código nunca é registrado em log nem auditoria
    const actor = await actorFor(user);
    await recordAuditEvent({ userId: user.id, action: "CLAUDE_LOGIN_COMPLETED", status: "SUCCESS", entityType: "ClaudeAuth", entityId: "server", ipAddress: actor.ip, userAgent: actor.userAgent });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
