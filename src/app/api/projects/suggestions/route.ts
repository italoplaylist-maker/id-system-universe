import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { suggestProjectAssignments } from "@/server/projects/project-service";

export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:read");
    const suggestions = await suggestProjectAssignments();
    return NextResponse.json({ suggestions });
  } catch (error) {
    return apiError(error);
  }
}
