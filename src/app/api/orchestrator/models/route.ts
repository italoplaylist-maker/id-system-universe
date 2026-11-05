import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listAvailableModels } from "@/server/orchestrator/models";

export const dynamic = "force-dynamic";

/** Modelos disponíveis neste momento para a conta do Claude conectada. Sem login, devolve lista vazia + motivo. */
export async function GET(request: Request) {
  try {
    await guard(false);
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    try {
      return NextResponse.json({ models: await listAvailableModels(force), error: null });
    } catch (e) {
      return NextResponse.json({ models: [], error: e instanceof Error ? e.message : "Não foi possível consultar os modelos." });
    }
  } catch (error) {
    return apiError(error);
  }
}
