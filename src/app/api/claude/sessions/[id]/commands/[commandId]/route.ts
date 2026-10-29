import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { cancelCommand } from "@/server/claude/agent-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; commandId: string }> }) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    const { id, commandId } = await params;
    await cancelCommand(id, commandId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
