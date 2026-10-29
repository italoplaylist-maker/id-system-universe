import { NextResponse } from "next/server";
import { apiError, readJson } from "@/server/http/api-helpers";
import { UnauthorizedLikeError } from "@/lib/errors";
import { ingestAgentMetrics } from "@/server/monitoring/ingest";

/** Endpoint de MÁQUINA: autentica por token do servidor (Bearer), não por sessão. */
export async function POST(request: Request) {
  try {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthorizedLikeError();
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return NextResponse.json(await ingestAgentMetrics(token, await readJson(request), forwarded));
  } catch (error) {
    return apiError(error);
  }
}
