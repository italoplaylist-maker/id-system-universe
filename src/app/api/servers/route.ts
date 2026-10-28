import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { createServer, listServers } from "@/server/monitoring/server-service";

export async function GET() {
  try {
    const user = await authorize("provider:read");
    await requireGlobalScope(user);
    return NextResponse.json({ servers: await listServers() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    const created = await createServer(await readJson(request), await actorFor(user));
    return NextResponse.json({ server: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
