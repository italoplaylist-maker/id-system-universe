import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { listApplications } from "@/server/applications/application-service";
import type { UniverseApplicationStatus } from "@/types/domain";

const VALID_STATUSES: UniverseApplicationStatus[] = ["RUNNING", "STOPPED", "DEPLOYING", "ERROR", "UNKNOWN"];

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:read");

    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId") ?? undefined;
    const query = url.searchParams.get("q") ?? undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam && VALID_STATUSES.includes(statusParam as UniverseApplicationStatus) ? (statusParam as UniverseApplicationStatus) : undefined;

    const applications = await listApplications({ providerId, query, status });
    return NextResponse.json({ applications });
  } catch (error) {
    return apiError(error);
  }
}
