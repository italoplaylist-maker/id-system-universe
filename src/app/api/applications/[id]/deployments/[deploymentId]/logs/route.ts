import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { assertApplicationAccess } from "@/server/auth/project-access";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { getApplicationDeploymentLogs } from "@/server/applications/application-service";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; deploymentId: string }>;

/** Log de UM deploy: do histórico guardado no Universe ou, se ainda rodando/recente, direto do Coolify. */
export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:read");
    const { id, deploymentId } = await params;
    await assertApplicationAccess(user, id);
    return NextResponse.json(await getApplicationDeploymentLogs(id, deploymentId));
  } catch (error) {
    return apiError(error);
  }
}
