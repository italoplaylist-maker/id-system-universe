import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listRoutines } from "@/server/orchestrator/routines";

export const dynamic = "force-dynamic";

/** Rotinas agendadas dos agentes (horário, dias, prioridade, gatilho e última execução). */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json({ routines: await listRoutines() });
  } catch (error) {
    return apiError(error);
  }
}
