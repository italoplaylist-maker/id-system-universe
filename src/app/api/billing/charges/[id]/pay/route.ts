import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { getChargeDetail, payCharge } from "@/server/billing/charge-service";

type Params = Promise<{ id: string }>;

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:manage");
    const { id } = await params;
    await payCharge(id, await readJson(request), user, await actorFor(user));
    return NextResponse.json({ charge: await getChargeDetail(id, user) });
  } catch (error) {
    return apiError(error);
  }
}
