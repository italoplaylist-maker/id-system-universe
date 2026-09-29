import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { syncAllProviders } from "@/server/applications/application-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

/** Global "Refresh" button — pulls fresh application lists from every enabled provider. */
export async function POST() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:read");
    consumeRateLimit(`sync:${user.id}`, 6, 60_000);
    await syncAllProviders();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
