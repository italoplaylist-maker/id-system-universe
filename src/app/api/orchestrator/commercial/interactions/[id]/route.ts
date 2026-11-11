import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { decideInteraction } from "@/server/orchestrator/commercial";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;
const bodySchema = z.object({ decision: z.enum(["approve", "reject", "sent"]) });

/** Decisão humana sobre um rascunho de abordagem. "sent" = o Italo enviou por fora; o Universe nunca envia. */
export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await guard(true);
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Decisão inválida.");
    const { id } = await params;
    await decideInteraction(id, parsed.data.decision, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
