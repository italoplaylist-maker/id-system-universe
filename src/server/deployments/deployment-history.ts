import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/server/claude/agent-service";
import type { DeploymentProvider, LogLine, ProviderDeployment } from "@/providers/deployment/types";
import type { UniverseDeployment } from "@/types/domain";

/** O Coolify apaga deploys antigos: guardamos o log de cada deploy quando ele termina. Limite por deploy (fim do log vale mais). */
export const MAX_STORED_LOG_CHARS = 400_000;

const FINAL = new Set(["SUCCESS", "FAILED", "CANCELLED"]);
export const isFinalDeployment = (status: string) => FINAL.has(status);

/** Texto do log pronto para guardar: segredos mascarados e, se enorme, só o final (onde está o erro). */
export function packLog(lines: LogLine[]): string {
  const text = redactSecrets(lines.map((l) => l.raw).join("\n"));
  return text.length > MAX_STORED_LOG_CHARS ? `[… início do log omitido …]\n${text.slice(text.length - MAX_STORED_LOG_CHARS)}` : text;
}

/** Reconstrói as linhas (com nível) a partir do texto guardado. */
export function unpackLog(text: string, classify: (line: string) => LogLine["level"]): LogLine[] {
  return text.split("\n").filter((l) => l.length > 0).map((l) => ({ raw: l, level: classify(l) }));
}

const levelOf = (line: string): LogLine["level"] => (/\b(error|panic|fatal|exception|fail(ed|ure)?)\b/i.test(line) ? "ERROR" : /\b(warn(ing)?|deprecat\w*)\b/i.test(line) ? "WARN" : "INFO");

const meta = (d: ProviderDeployment) => ({
  status: d.status,
  commit: d.commit ?? null,
  commitMessage: d.commitMessage ?? null,
  startedAt: d.startedAt ? new Date(d.startedAt) : null,
  finishedAt: d.finishedAt ? new Date(d.finishedAt) : null,
});

/** Guarda (ou atualiza) o deploy no histórico; com `lines`, guarda também o log. Nunca derruba quem chama. */
export async function snapshotDeployment(applicationId: string, deployment: ProviderDeployment, lines?: LogLine[]): Promise<void> {
  try {
    const data = { ...meta(deployment), ...(lines && lines.length > 0 ? { logs: packLog(lines), logsSavedAt: new Date() } : {}) };
    await prisma.deploymentCache.upsert({
      where: { applicationId_externalId: { applicationId, externalId: deployment.externalId } },
      create: { applicationId, externalId: deployment.externalId, ...data },
      update: data,
    });
  } catch (error) {
    logger.warn("deployment_snapshot_failed", { applicationId, deploymentId: deployment.externalId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Chamado quando o Universe vê o deploy terminar: baixa o log e guarda no histórico (melhor esforço). */
export async function saveFinishedDeployment(applicationId: string, provider: DeploymentProvider, deployment: ProviderDeployment): Promise<void> {
  if (!isFinalDeployment(deployment.status)) return;
  let lines: LogLine[] | undefined;
  try {
    lines = await provider.getDeploymentLogs(deployment.externalId);
  } catch (error) {
    logger.warn("deployment_log_fetch_failed", { applicationId, deploymentId: deployment.externalId, error: error instanceof Error ? error.message : String(error) });
  }
  await snapshotDeployment(applicationId, deployment, lines);
}

/**
 * Histórico de deploys: o que o Coolify ainda lista + o que já guardamos (inclusive deploys que o Coolify apagou).
 * Se o Coolify estiver fora do ar, o histórico guardado continua aparecendo.
 */
export async function listDeploymentHistory(applicationId: string, provider: DeploymentProvider, applicationExternalId: string): Promise<UniverseDeployment[]> {
  let live: ProviderDeployment[] = [];
  try {
    live = await provider.listDeployments(applicationExternalId);
  } catch (error) {
    logger.warn("deployment_list_failed", { applicationId, error: error instanceof Error ? error.message : String(error) });
  }
  // Metadados dos deploys atuais entram no histórico (sem baixar logs de todos: isso é feito ao terminar ou ao abrir).
  await Promise.all(live.map((d) => snapshotDeployment(applicationId, d)));
  const stored = await prisma.deploymentCache.findMany({ where: { applicationId }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }], take: 100, select: { externalId: true, status: true, commit: true, commitMessage: true, startedAt: true, finishedAt: true, logsSavedAt: true } });
  const rows = new Map<string, UniverseDeployment>();
  for (const s of stored) {
    rows.set(s.externalId, { id: s.externalId, externalId: s.externalId, status: s.status as UniverseDeployment["status"], commit: s.commit, commitMessage: s.commitMessage, startedAt: s.startedAt?.toISOString() ?? null, finishedAt: s.finishedAt?.toISOString() ?? null, hasLogs: s.logsSavedAt !== null });
  }
  // O que o Coolify diz agora vale mais que o guardado (status muda enquanto roda); se ele ainda lista o deploy, o log dá para buscar.
  for (const d of live) {
    rows.set(d.externalId, { id: d.externalId, externalId: d.externalId, status: d.status, commit: d.commit ?? null, commitMessage: d.commitMessage ?? null, startedAt: d.startedAt ?? null, finishedAt: d.finishedAt ?? null, hasLogs: true });
  }
  return [...rows.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export interface DeploymentLogResult {
  lines: LogLine[];
  status: UniverseDeployment["status"];
  /** "history" = guardado no Universe; "live" = lido agora do Coolify. */
  source: "history" | "live" | "none";
}

/** Log de um deploy: do histórico se já terminou e foi guardado; senão direto do Coolify (e guarda se terminou). */
export async function getDeploymentLogs(applicationId: string, provider: DeploymentProvider, deploymentExternalId: string): Promise<DeploymentLogResult> {
  const stored = await prisma.deploymentCache.findUnique({ where: { applicationId_externalId: { applicationId, externalId: deploymentExternalId } } });
  if (stored?.logs && isFinalDeployment(stored.status)) return { lines: unpackLog(stored.logs, levelOf), status: stored.status as UniverseDeployment["status"], source: "history" };
  try {
    const [deployment, lines] = await Promise.all([provider.getDeployment(deploymentExternalId), provider.getDeploymentLogs(deploymentExternalId)]);
    if (isFinalDeployment(deployment.status)) await snapshotDeployment(applicationId, deployment, lines);
    return { lines, status: deployment.status, source: "live" };
  } catch (error) {
    // Coolify já não tem esse deploy (ou está fora do ar): se guardamos algo, mostra; senão, repassa o erro.
    if (stored?.logs) return { lines: unpackLog(stored.logs, levelOf), status: stored.status as UniverseDeployment["status"], source: "history" };
    if (stored) return { lines: [], status: stored.status as UniverseDeployment["status"], source: "none" };
    throw error;
  }
}
