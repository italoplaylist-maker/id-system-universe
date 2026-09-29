import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { updateUser } from "@/server/users/user-service";

type Params = Promise<{ id: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "user:manage");
    const { id } = await params;
    const meta = await getRequestMeta();
    const body = await request.json();
    const updated = await updateUser(id, body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ user: updated });
  } catch (error) {
    return apiError(error);
  }
}
