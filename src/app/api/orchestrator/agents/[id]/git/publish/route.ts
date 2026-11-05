import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { publishChanges } from "@/server/orchestrator/git/ops";
import { consumeRateLimit } from "@/server/security/rate-limit";

/** Botão "Enviar para o GitHub": commit + push em branch própria + PR (mesma lógica da ferramenta do agente). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    consumeRateLimit(`agent-publish:${user.id}`, 10, 60_000);
    const { id } = await params;
    const parsed = z.object({ title: z.string().trim().max(200).optional(), body: z.string().max(5000).optional() }).safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Título ou descrição inválidos.");
    return NextResponse.json(await publishChanges(id, { ...parsed.data, actorUserId: user.id }));
  } catch (error) {
    return apiError(error);
  }
}
