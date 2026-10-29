import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { listCommands, queueCommand } from "@/server/claude/agent-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const user = await authorize("provider:read");
    await requireGlobalScope(user);
    return NextResponse.json({ commands: await listCommands((await params).id) });
  } catch (error) {
    return apiError(error);
  }
}

/** Enviar pedido a uma sessão exige permissão de escrita — é dar ordem a um agente. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const user = await authorize("provider:write");
    await requireGlobalScope(user);
    return NextResponse.json({ command: await queueCommand((await params).id, await readJson(request), await actorFor(user)) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
