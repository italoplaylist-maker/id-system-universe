import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listTasks, submitTask } from "@/server/orchestrator/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard(false);
    const { id } = await params;
    return NextResponse.json({ tasks: await listTasks({ agentId: id, scope: "history", limit: 50 }) });
  } catch (error) {
    return apiError(error);
  }
}

/** Responde na hora (202): a execução acontece em segundo plano. Mesma idempotencyKey = mesma tarefa. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    const { task, duplicate } = await submitTask(id, await readJson(request), await actorFor(user));
    return NextResponse.json({ task, duplicate }, { status: duplicate ? 200 : 202 });
  } catch (error) {
    return apiError(error);
  }
}
