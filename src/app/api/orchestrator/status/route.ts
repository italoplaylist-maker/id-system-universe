import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { getClaudeAuthStatus } from "@/server/orchestrator/claude-auth";
import { STALE_AFTER_MS } from "@/server/orchestrator/worker";

export const dynamic = "force-dynamic";

/** Estado real do login do Claude neste servidor (consulta a própria CLI; sem expor segredo). */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json({ ...(await getClaudeAuthStatus()), staleAfterMs: STALE_AFTER_MS });
  } catch (error) {
    return apiError(error);
  }
}
