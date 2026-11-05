import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { cancelTask } from "@/server/orchestrator/worker";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    return NextResponse.json(await cancelTask(id, await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
