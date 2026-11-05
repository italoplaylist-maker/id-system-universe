import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { mergePullRequest } from "@/server/orchestrator/git/ops";
import { consumeRateLimit } from "@/server/security/rate-limit";

export const maxDuration = 60;

/** Botão "Fazer merge": squash, só com verificações verdes; depois apaga a cópia (se tudo estiver enviado). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    consumeRateLimit(`agent-merge:${user.id}`, 10, 60_000);
    const { id } = await params;
    return NextResponse.json(await mergePullRequest(id, { actorUserId: user.id }));
  } catch (error) {
    return apiError(error);
  }
}
