import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "./guard";
import { recordAuditEvent } from "@/server/audit/audit-log";

/** Envelope comum das rotas de ferramentas: permissão de escrita, auditoria e resposta/erro padronizados. */
export async function toolsMutation(write: boolean, what: string, fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const user = await guard(write);
    const data = await fn();
    if (write) {
      const actor = await actorFor(user);
      await recordAuditEvent({ userId: user.id, action: "AGENT_TOOLS_CHANGED", status: "SUCCESS", entityType: "AgentTools", entityId: what, ipAddress: actor.ip, userAgent: actor.userAgent });
    }
    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    return apiError(error);
  }
}
