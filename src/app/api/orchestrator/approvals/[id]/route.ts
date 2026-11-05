import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { decideTaskApproval } from "@/server/orchestrator/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    return NextResponse.json(await decideTaskApproval(id, await readJson(request), await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
