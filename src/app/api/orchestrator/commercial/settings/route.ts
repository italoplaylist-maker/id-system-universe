import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { getCommercialSettings, updateCommercialSettings } from "@/server/orchestrator/commercial";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await guard(false);
    return NextResponse.json(await getCommercialSettings());
  } catch (error) {
    return apiError(error);
  }
}

/** Região, raio, segmentos, limite de leads por execução e preço por milhão de tokens. */
export async function PUT(request: Request) {
  try {
    const user = await guard(true);
    return NextResponse.json(await updateCommercialSettings(await readJson(request), await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
