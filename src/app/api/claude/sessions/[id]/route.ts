import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { getSessionTimeline } from "@/server/claude/agent-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("provider:read");
    await requireGlobalScope(user);
    return NextResponse.json(await getSessionTimeline((await params).id));
  } catch (error) {
    return apiError(error);
  }
}
