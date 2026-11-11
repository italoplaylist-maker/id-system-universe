import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { startCommercialCycle } from "@/server/orchestrator/commercial";

export const dynamic = "force-dynamic";

/** Executa UM ciclo coordenado (Garimpeiro → Analista → CRM → Vendedor). Respeita pausa e orçamento; um por vez; sem repetição. */
export async function POST() {
  try {
    const user = await guard(true);
    return NextResponse.json(await startCommercialCycle(await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
