import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { cleanupWorkspace } from "@/server/orchestrator/git/ops";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    return NextResponse.json(await cleanupWorkspace(id, { actorUserId: user.id, repo: new URL(request.url).searchParams.get("repo") }));
  } catch (error) {
    return apiError(error);
  }
}
