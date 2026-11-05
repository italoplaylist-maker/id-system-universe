import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { createAgent, listRoomAgents } from "@/server/orchestrator/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await guard(false);
    return NextResponse.json({ agents: await listRoomAgents() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await guard(true);
    const agent = await createAgent(await readJson(request), await actorFor(user));
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
