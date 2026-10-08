import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { removeInstallation } from "@/server/github/github-service";

type Params = Promise<{ id: string }>;

export async function DELETE(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");
    const { id } = await params;
    const meta = await getRequestMeta();
    await removeInstallation(id, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
