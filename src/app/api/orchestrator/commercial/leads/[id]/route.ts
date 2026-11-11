import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { LEAD_STAGE_IDS } from "@/lib/commercial-team";
import { setLeadStage } from "@/server/orchestrator/commercial";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;
const bodySchema = z.object({ stage: z.enum(LEAD_STAGE_IDS).optional(), discarded: z.boolean().optional(), note: z.string().trim().max(500).optional() });

/** Intervenção manual do Italo no funil (etapa, descarte). Convertido e Perdido só saem daqui. */
export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await guard(true);
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Dados inválidos.");
    const { id } = await params;
    await setLeadStage(id, parsed.data, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
