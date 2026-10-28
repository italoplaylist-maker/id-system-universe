import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { deleteServer, renameServer } from "@/server/monitoring/server-service";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    await renameServer((await params).id, await readJson(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    await deleteServer((await params).id, await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
