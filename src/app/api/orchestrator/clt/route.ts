import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { cltOverview, ensureCltTeam } from "@/server/orchestrator/clt";

export const dynamic = "force-dynamic";

/** Painel da equipe AGENTES CLT (estado, tarefas e tokens reais). */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json(await cltOverview());
  } catch (error) {
    return apiError(error);
  }
}

/** Cria os 7 funcionários que ainda não existem (idempotente). */
export async function POST() {
  try {
    const user = await guard(true);
    return NextResponse.json(await ensureCltTeam(await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
