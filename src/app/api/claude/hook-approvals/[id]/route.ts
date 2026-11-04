import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { UnauthorizedLikeError } from "@/lib/errors";
import { getApprovalForHook } from "@/server/claude/agent-service";

/** Endpoint de MÁQUINA: o hook consulta se você já decidiu (Bearer = token da fonte). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthorizedLikeError();
    return NextResponse.json(await getApprovalForHook(token, (await params).id));
  } catch (error) {
    return apiError(error);
  }
}
