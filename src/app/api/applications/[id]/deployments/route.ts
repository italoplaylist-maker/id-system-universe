import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { listApplicationDeployments } from "@/server/applications/application-service";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:read");
    const { id } = await params;
    const deployments = await listApplicationDeployments(id);
    return NextResponse.json({ deployments });
  } catch (error) {
    return apiError(error);
  }
}
