import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { startApplication } from "@/server/applications/application-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Params = Promise<{ id: string }>;

export async function POST(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:start");
    const { id } = await params;
    consumeRateLimit(`action:${user.id}:${id}`, 6, 60_000);
    const meta = await getRequestMeta();
    const application = await startApplication(id, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ application });
  } catch (error) {
    return apiError(error);
  }
}
