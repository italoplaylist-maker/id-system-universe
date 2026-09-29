import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { getApplicationLogs } from "@/server/applications/application-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:logs");
    const { id } = await params;

    // Logs polling is the highest-frequency read in the app (fast poll while
    // the panel is open) — keep it bounded per user regardless.
    consumeRateLimit(`logs:${user.id}:${id}`, 30, 60_000);

    const url = new URL(request.url);
    const lines = Math.min(Math.max(Number(url.searchParams.get("lines") ?? 500), 50), 2000);

    const result = await getApplicationLogs(id, lines);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
