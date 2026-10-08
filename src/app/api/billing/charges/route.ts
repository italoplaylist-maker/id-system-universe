import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { createCharge, listCharges } from "@/server/billing/charge-service";
import { createRecurrence } from "@/server/billing/recurrence-service";
import { parseChargeFilters } from "@/server/billing/filters";

export async function GET(request: Request) {
  try {
    const user = await authorize("billing:view");
    return NextResponse.json(await listCharges(parseChargeFilters(new URL(request.url).searchParams), user));
  } catch (error) {
    return apiError(error);
  }
}

/** Cobrança avulsa; com `recurrence` informado cria a recorrência (que gera as cobranças por competência). */
export async function POST(request: Request) {
  try {
    const user = await authorize("billing:manage");
    const actor = await actorFor(user);
    const body = (await readJson(request)) as Record<string, unknown>;
    if (body && typeof body === "object" && body.recurrence && typeof body.recurrence === "object") {
      const { recurrence, dueDate, ...rest } = body as { recurrence: Record<string, unknown>; dueDate?: string } & Record<string, unknown>;
      const result = await createRecurrence({ ...rest, ...recurrence, startDate: recurrence.startDate ?? dueDate }, user, actor);
      return NextResponse.json({ recurrence: result }, { status: 201 });
    }
    return NextResponse.json({ charge: await createCharge(body, user, actor) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
