import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { createFeed, listFeeds } from "@/server/claude/agent-service";

export async function GET() {
  try {
    const user = await authorize("provider:read");
    await requireGlobalScope(user);
    return NextResponse.json({ feeds: await listFeeds() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    return NextResponse.json({ feed: await createFeed(await readJson(request), await actorFor(user)) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
