import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listFixQueue } from "@/server/orchestrator/fix-queue";

export const dynamic = "force-dynamic";

/** Erros que a equipe CLT viu e que podem ser mandados para o ID Manager corrigir. */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json(await listFixQueue());
  } catch (error) {
    return apiError(error);
  }
}
