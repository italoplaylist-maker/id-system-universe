import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { routeAndSubmit } from "@/server/orchestrator/clt";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ prompt: z.string().trim().min(3).max(20000), idempotencyKey: z.string().trim().min(8).max(100).optional() });

/** O ID Manager recebe o pedido, escolhe o especialista e enfileira (recusa duplicata e agente sem orçamento). */
export async function POST(request: Request) {
  try {
    const user = await guard(true);
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    return NextResponse.json(await routeAndSubmit(parsed.data.prompt, await actorFor(user), parsed.data.idempotencyKey));
  } catch (error) {
    return apiError(error);
  }
}
