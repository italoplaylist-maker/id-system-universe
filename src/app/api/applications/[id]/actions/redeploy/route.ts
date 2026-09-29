import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { redeployApplication } from "@/server/applications/application-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Params = Promise<{ id: string }>;

const bodySchema = z.object({ force: z.boolean().optional().default(false) });

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    consumeRateLimit(`action:${user.id}:${id}`, 6, 60_000);

    const raw = await request.json().catch(() => ({}));
    const { force } = bodySchema.parse(raw);
    requirePermission(user, force ? "application:force-redeploy" : "application:redeploy");

    const meta = await getRequestMeta();
    const application = await redeployApplication(id, force, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ application });
  } catch (error) {
    return apiError(error);
  }
}
