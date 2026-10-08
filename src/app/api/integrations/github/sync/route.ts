import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { syncAllInstallations, listInstallations } from "@/server/github/github-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

export async function POST() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");
    consumeRateLimit(`github-sync:${user.id}`, 6, 60_000);
    await syncAllInstallations();
    return NextResponse.json({ installations: await listInstallations() });
  } catch (error) {
    return apiError(error);
  }
}
