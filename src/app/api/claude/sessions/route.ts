import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { listActiveSessions } from "@/server/claude/agent-service";

export async function GET() {
  try {
    const user = await authorize("provider:read");
    await requireGlobalScope(user);
    return NextResponse.json({ sessions: await listActiveSessions() });
  } catch (error) {
    return apiError(error);
  }
}
