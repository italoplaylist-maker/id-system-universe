import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { createProject, listProjects } from "@/server/projects/project-service";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:read");
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const projects = await listProjects({ includeArchived });
    return NextResponse.json({ projects });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    const meta = await getRequestMeta();
    const body = await request.json();
    const project = await createProject(body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
