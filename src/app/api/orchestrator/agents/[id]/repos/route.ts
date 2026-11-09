import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { addExtraRepo, getAgentRepos, removeExtraRepo } from "@/server/orchestrator/service";

export const dynamic = "force-dynamic";

/** Repositórios do agente: o principal + os extras. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard(false);
    const { id } = await params;
    return NextResponse.json(await getAgentRepos(id));
  } catch (error) {
    return apiError(error);
  }
}

/** Conecta um repositório EXTRA ao agente (opcionalmente a todos os agentes). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    return NextResponse.json(await addExtraRepo(id, await readJson(request), await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    const extraId = new URL(request.url).searchParams.get("extraId") ?? "";
    return NextResponse.json(await removeExtraRepo(id, extraId, await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
