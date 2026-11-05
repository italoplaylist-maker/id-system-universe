import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { archiveAgent, updateAgent } from "@/server/orchestrator/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    return NextResponse.json({ agent: await updateAgent(id, await readJson(request), await actorFor(user)) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    await archiveAgent(id, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
