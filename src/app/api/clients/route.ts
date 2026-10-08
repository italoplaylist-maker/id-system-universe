import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { getProjectScope } from "@/server/auth/project-access";
import { createClient, listClients } from "@/server/billing/client-service";

export async function GET(request: Request) {
  try {
    const user = await authorize("billing:view");
    const url = new URL(request.url);
    const clients = await listClients(await getProjectScope(user), { q: url.searchParams.get("q") ?? undefined, includeInactive: url.searchParams.get("includeInactive") === "true" });
    return NextResponse.json({ clients });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorize("billing:manage");
    return NextResponse.json({ client: await createClient(await readJson(request), user, await actorFor(user)) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
