import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { cltAgentDashboard } from "@/server/orchestrator/clt-dashboard";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** Painel de um agente da equipe CLT (tokens/tarefas por dia, últimas tarefas, rotinas; no Manager, a visão da operação). */
export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    await guard(false);
    const { id } = await params;
    return NextResponse.json(await cltAgentDashboard(id));
  } catch (error) {
    return apiError(error);
  }
}
