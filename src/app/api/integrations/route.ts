import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { getIntegrationsOverview } from "@/server/integrations/overview";

export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");
    return NextResponse.json({ integrations: await getIntegrationsOverview() });
  } catch (error) {
    return apiError(error);
  }
}
