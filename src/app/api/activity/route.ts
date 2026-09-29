import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { prisma } from "@/server/db/client";
import { listRecentUniverseEvents } from "@/server/events/universe-events";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "activity:read");

    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);

    const [auditEvents, universeEvents] = await Promise.all([
      prisma.auditEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { user: { select: { email: true } }, provider: { select: { name: true } }, application: { select: { name: true } } },
      }),
      listRecentUniverseEvents(limit),
    ]);

    return NextResponse.json({ auditEvents, universeEvents });
  } catch (error) {
    return apiError(error);
  }
}
