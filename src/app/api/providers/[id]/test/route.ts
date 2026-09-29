import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { testProviderConnection } from "@/server/providers/provider-service";
import { syncProviderApplications } from "@/server/applications/application-service";

type Params = Promise<{ id: string }>;

export async function POST(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:test-connection");
    const { id } = await params;
    const meta = await getRequestMeta();

    const result = await testProviderConnection(id, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    if (result.ok) {
      await syncProviderApplications(id).catch(() => undefined);
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
