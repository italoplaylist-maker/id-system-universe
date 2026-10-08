import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { getBillingSummary } from "@/server/billing/charge-service";
import { parseChargeFilters } from "@/server/billing/filters";

export async function GET(request: Request) {
  try {
    const user = await authorize("billing:view");
    const filters = parseChargeFilters(new URL(request.url).searchParams);
    return NextResponse.json({ summary: await getBillingSummary(filters, user) });
  } catch (error) {
    return apiError(error);
  }
}
