import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { decideApproval } from "@/server/claude/agent-service";

/** Aprovar/negar a execução de uma ferramenta num agente: exige escrita + escopo global e fica na auditoria. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    return NextResponse.json(await decideApproval((await params).id, await readJson(request), await actorFor(user)));
  } catch (error) {
    return apiError(error);
  }
}
