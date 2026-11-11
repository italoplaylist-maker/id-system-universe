import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { ensureCommercialTeam } from "@/server/orchestrator/commercial";

export const dynamic = "force-dynamic";

/** Cria os 4 funcionários comerciais que ainda não existem (idempotente). As rotinas nascem desligadas. */
export async function POST() {
  try {
    const user = await guard(true);
    return NextResponse.json(await ensureCommercialTeam(await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
