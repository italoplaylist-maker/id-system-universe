import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { createRecurrence, listRecurrences } from "@/server/billing/recurrence-service";

export async function GET() {
  try {
    const user = await authorize("billing:view");
    return NextResponse.json({ recurrences: await listRecurrences(user) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorize("billing:manage");
    return NextResponse.json({ recurrence: await createRecurrence(await readJson(request), user, await actorFor(user)) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
