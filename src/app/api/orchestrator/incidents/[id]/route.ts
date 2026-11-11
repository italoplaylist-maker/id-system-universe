import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { actOnIncident } from "@/server/orchestrator/incidents";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
const bodySchema = z.object({ action: z.enum(["unlock", "resolve"]) });

/** Decisão humana sobre um incidente de deploy: liberar o agente bloqueado ou dar o incidente por resolvido. */
export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await guard(true);
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Ação inválida.");
    const { id } = await params;
    return NextResponse.json({ incident: await actOnIncident(id, parsed.data.action, await actorFor(user)) });
  } catch (error) {
    return apiError(error);
  }
}
