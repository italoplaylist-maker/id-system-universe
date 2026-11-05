import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { getTaskDetail } from "@/server/orchestrator/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard(false);
    const { id } = await params;
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
    return NextResponse.json(await getTaskDetail(id, after));
  } catch (error) {
    return apiError(error);
  }
}
