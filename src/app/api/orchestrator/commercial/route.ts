import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { commercialOverview } from "@/server/orchestrator/commercial";

export const dynamic = "force-dynamic";

/** Painel da equipe COMERCIAL & MARKETING: agentes, funil, indicadores e abordagens pendentes (tudo do banco). */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json(await commercialOverview());
  } catch (error) {
    return apiError(error);
  }
}
