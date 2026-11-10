import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { updateRoutine } from "@/server/orchestrator/routines";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** Edita horário, dias, prioridade, gatilho, agente, texto e liga/desliga a rotina. */
export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    return NextResponse.json({ routine: await updateRoutine(id, await readJson(request), await actorFor(user)) });
  } catch (error) {
    return apiError(error);
  }
}
