import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { dismissFix, sendToFix } from "@/server/orchestrator/fix-queue";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
const bodySchema = z.object({ action: z.enum(["fix", "dismiss"]) });

/** Decisão humana sobre um erro da fila: mandar o ID Manager corrigir (um por vez) ou descartar. */
export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await guard(true);
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Ação inválida.");
    const { id } = await params;
    const actor = await actorFor(user);
    return NextResponse.json(parsed.data.action === "fix" ? await sendToFix(id, actor) : await dismissFix(id, actor));
  } catch (error) {
    return apiError(error);
  }
}
