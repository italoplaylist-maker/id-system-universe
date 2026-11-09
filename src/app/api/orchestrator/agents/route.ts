import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { createAgent, listRoomAgents } from "@/server/orchestrator/service";
import { syncProjectAgents } from "@/server/orchestrator/workspace";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/server/claude/agent-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await guard(false);
    // Um funcionário por Projeto, sem ninguém precisar cadastrar. Se a criação falhar, a lista dos que já existem ainda sai.
    await syncProjectAgents().catch((error) => logger.error("orchestrator_sync_agents_failed", { message: error instanceof Error ? error.message : String(error) }));
    return NextResponse.json({ agents: await listRoomAgents() });
  } catch (error) {
    const res = apiError(error);
    // Quem chegou aqui já passou pela autorização do orquestrador (só administradores com acesso global): o motivo real ajuda a diagnosticar.
    if (res.status >= 500) {
      const detail = redactSecrets(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(-300);
      return NextResponse.json({ error: "Falha ao listar os agentes.", code: "INTERNAL_ERROR", detail }, { status: res.status });
    }
    return res;
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
