import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listTasks } from "@/server/orchestrator/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await guard(false);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "history" ? "history" : "active";
    const agentId = url.searchParams.get("agentId") ?? undefined;
    return NextResponse.json({ tasks: await listTasks({ agentId, scope, limit: 60 }) });
  } catch (error) {
    return apiError(error);
  }
}
