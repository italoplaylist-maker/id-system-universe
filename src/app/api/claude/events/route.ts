import { NextResponse } from "next/server";
import { apiError, readJson } from "@/server/http/api-helpers";
import { UnauthorizedLikeError } from "@/lib/errors";
import { ingestHookEvent } from "@/server/claude/agent-service";

/** Endpoint de MÁQUINA (hook do Claude Code): autentica por token da fonte (Bearer), não por sessão. */
export async function POST(request: Request) {
  try {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthorizedLikeError();
    return NextResponse.json(await ingestHookEvent(token, await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}
