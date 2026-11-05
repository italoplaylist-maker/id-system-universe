import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { startClaudeLogin } from "@/server/orchestrator/claude-auth";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/audit/audit-log";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await guard(true);
    consumeRateLimit(`claude-login:${user.id}`, 10, 10 * 60_000);
    const actor = await actorFor(user);
    const result = await startClaudeLogin();
    await recordAuditEvent({ userId: user.id, action: "CLAUDE_LOGIN_STARTED", status: "SUCCESS", entityType: "ClaudeAuth", entityId: "server", ipAddress: actor.ip, userAgent: actor.userAgent });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
