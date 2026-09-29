import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { assignResourcesToProject } from "@/server/projects/project-service";

type Params = Promise<{ id: string }>;

/** Assigns one or more unassigned (or reassigned) resources to this project. */
export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    const { id } = await params;
    const meta = await getRequestMeta();
    const body = await request.json();
    const result = await assignResourcesToProject(id, body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
