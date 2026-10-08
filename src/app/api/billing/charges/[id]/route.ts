import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { getChargeDetail, updateCharge } from "@/server/billing/charge-service";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:view");
    const { id } = await params;
    return NextResponse.json({ charge: await getChargeDetail(id, user) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:manage");
    const { id } = await params;
    await updateCharge(id, await readJson(request), user, await actorFor(user));
    return NextResponse.json({ charge: await getChargeDetail(id, user) });
  } catch (error) {
    return apiError(error);
  }
}
