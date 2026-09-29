import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { createProvider, listProviders } from "@/server/providers/provider-service";
import { syncProviderApplications } from "@/server/applications/application-service";

export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:read");
    const providers = await listProviders();
    return NextResponse.json({ providers });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:write");
    const meta = await getRequestMeta();
    const body = await request.json();

    const provider = await createProvider(body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    // Best-effort initial sync so the provider isn't empty in the UI until the next refresh cycle.
    syncProviderApplications(provider.id).catch(() => undefined);

    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
