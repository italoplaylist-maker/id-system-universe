import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { assertApplicationAccess } from "@/server/auth/project-access";
import { getResourceRepository, removeResourceRepository, setResourceRepository } from "@/server/github/resource-repository";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:read");
    const { id } = await params;
    await assertApplicationAccess(user, id);
    return NextResponse.json({ repository: await getResourceRepository(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    const { id } = await params;
    await assertApplicationAccess(user, id);
    const meta = await getRequestMeta();
    const repository = await setResourceRepository(id, await request.json(), { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ repository });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    const { id } = await params;
    await assertApplicationAccess(user, id);
    const meta = await getRequestMeta();
    await removeResourceRepository(id, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
