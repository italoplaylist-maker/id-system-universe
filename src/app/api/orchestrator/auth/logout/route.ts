import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { claudeLogout } from "@/server/orchestrator/claude-auth";
import { recordAuditEvent } from "@/server/audit/audit-log";

export async function POST() {
  try {
    const user = await guard(true);
    await claudeLogout();
    const actor = await actorFor(user);
    await recordAuditEvent({ userId: user.id, action: "CLAUDE_LOGOUT", status: "SUCCESS", entityType: "ClaudeAuth", entityId: "server", ipAddress: actor.ip, userAgent: actor.userAgent });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
