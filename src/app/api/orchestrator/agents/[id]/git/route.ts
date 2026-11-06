import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { getGitStatus } from "@/server/orchestrator/git/ops";

export const dynamic = "force-dynamic";

/** Estado Git do agente (cópia, PRs) e, com ?permissions=1, o que falta no GitHub App para ele poder publicar. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard(false);
    const { id } = await params;
    const checkPermissions = new URL(request.url).searchParams.get("permissions") === "1";
    const repo = new URL(request.url).searchParams.get("repo");
    return NextResponse.json(await getGitStatus(id, { checkPermissions, repo }));
  } catch (error) {
    return apiError(error);
  }
}
