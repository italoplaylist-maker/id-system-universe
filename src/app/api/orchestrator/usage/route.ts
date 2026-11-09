import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { getClaudeUsage } from "@/server/orchestrator/usage";

export const dynamic = "force-dynamic";

/** Uso do plano do Claude (5 h / 7 dias) e tokens gastos pelos agentes. Só leitura; falha do Claude não derruba a resposta. */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json(await getClaudeUsage());
  } catch (error) {
    return apiError(error);
  }
}
