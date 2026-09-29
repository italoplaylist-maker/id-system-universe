import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { deleteProject, getProjectDetail, updateProject } from "@/server/projects/project-service";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:read");
    const { id } = await params;
    const project = await getProjectDetail(id);
    return NextResponse.json({ project });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    const { id } = await params;
    const meta = await getRequestMeta();
    const body = await request.json();
    const project = await updateProject(id, body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ project });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    const { id } = await params;
    const meta = await getRequestMeta();
    await deleteProject(id, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
