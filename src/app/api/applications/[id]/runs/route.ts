import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { assertApplicationAccess } from "@/server/auth/project-access";
import { getRunsOverview } from "@/server/deployments/deployment-runs";

type Params = Promise<{ id: string }>;

/** Versão em produção + histórico recente de deploys (manuais e GitHub) do Resource. */
export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "application:read");
    const { id } = await params;
    await assertApplicationAccess(user, id);
    return NextResponse.json(await getRunsOverview(id));
  } catch (error) {
    return apiError(error);
  }
}
