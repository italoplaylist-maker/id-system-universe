import { NextResponse } from "next/server";
import { actorFor, apiError, authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { deleteFeed } from "@/server/claude/agent-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    await deleteFeed((await params).id, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
