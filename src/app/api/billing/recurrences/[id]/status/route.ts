import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { setRecurrenceStatus } from "@/server/billing/recurrence-service";

type Params = Promise<{ id: string }>;

const bodySchema = z.object({ action: z.enum(["PAUSE", "RESUME", "END"]) });

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:manage");
    const { id } = await params;
    const { action } = bodySchema.parse(await readJson(request));
    await setRecurrenceStatus(id, action, user, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
