import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { updateRecurrence } from "@/server/billing/recurrence-service";

type Params = Promise<{ id: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:manage");
    const { id } = await params;
    await updateRecurrence(id, await readJson(request), user, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
