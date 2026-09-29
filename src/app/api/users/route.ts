import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { createUser, listUsers } from "@/server/users/user-service";

export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "user:manage");
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "user:manage");
    const meta = await getRequestMeta();
    const body = await request.json();
    const created = await createUser(body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ user: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
