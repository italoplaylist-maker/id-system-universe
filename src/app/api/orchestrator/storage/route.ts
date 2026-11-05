import { NextResponse } from "next/server";
import { actorFor, apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { cleanupStorage, getStorageReport } from "@/server/orchestrator/storage";
import { recordAuditEvent } from "@/server/audit/audit-log";

export const dynamic = "force-dynamic";

/** Quanto espaço e memória o Universe está usando no servidor (workspaces dos agentes, ~/.claude, anexos, banco). */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json({ report: await getStorageReport() });
  } catch (error) {
    return apiError(error);
  }
}

/** "Limpar agora": apaga só o regenerável (dependências/builds ignorados pelo Git, transcrições velhas, caches, eventos antigos). */
export async function POST() {
  try {
    const user = await guard(true);
    const actor = await actorFor(user);
    const result = await cleanupStorage({ force: true });
    await recordAuditEvent({ userId: actor.userId, action: "STORAGE_CLEANUP", status: "SUCCESS", entityType: "Orchestrator", entityId: "storage", metadata: { freedBytes: result.freedBytes, actions: result.actions.length }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return NextResponse.json({ result, report: await getStorageReport() });
  } catch (error) {
    return apiError(error);
  }
}
