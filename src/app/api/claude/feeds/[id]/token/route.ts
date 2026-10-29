import { NextResponse } from "next/server";
import { actorFor, apiError, authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { rotateFeedToken } from "@/server/claude/agent-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    return NextResponse.json(await rotateFeedToken((await params).id, await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
