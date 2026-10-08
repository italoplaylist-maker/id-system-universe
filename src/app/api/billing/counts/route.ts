import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { getBillingCounts } from "@/server/billing/charge-service";

/** Somente contagens agregadas (sem valores/nomes) — alimenta o telão da Central de Comando. */
export async function GET() {
  try {
    const user = await authorize("billing:view");
    return NextResponse.json({ counts: await getBillingCounts(user) });
  } catch (error) {
    return apiError(error);
  }
}
