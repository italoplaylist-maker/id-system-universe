import { NextResponse } from "next/server";
import { actorFor, apiError, authorize } from "@/server/http/api-helpers";
import { getChargeDetail, cancelCharge } from "@/server/billing/charge-service";

type Params = Promise<{ id: string }>;

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:manage");
    const { id } = await params;
    await cancelCharge(id, user, await actorFor(user));
    return NextResponse.json({ charge: await getChargeDetail(id, user) });
  } catch (error) {
    return apiError(error);
  }
}
