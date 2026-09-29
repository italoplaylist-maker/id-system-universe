import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { testConnectionDryRun } from "@/server/providers/provider-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

/** Tests a Coolify connection before it's saved — see testConnectionDryRun. */
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:write");
    const meta = await getRequestMeta();
    consumeRateLimit(`provider-test-dry-run:${user.id}`, 15, 60_000);

    const body = await request.json();
    const result = await testConnectionDryRun(body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
