import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { getProjectScope } from "@/server/auth/project-access";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { suggestProjectAssignments } from "@/server/projects/project-service";

export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:read");
    const scope = await getProjectScope(user);
    // Sugestões envolvem recursos ainda sem Project: só para quem tem escopo global.
    const suggestions = scope.all ? await suggestProjectAssignments() : [];
    return NextResponse.json({ suggestions });
  } catch (error) {
    return apiError(error);
  }
}
