import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { createDeploymentProvider } from "@/server/providers/provider-registry";
import { redactSecrets } from "@/server/claude/agent-service";
import { extractErrorEvents, groupEvents, MAX_SAMPLE_CHARS, onlyNew } from "@/lib/error-logs";

/** Os erros agrupados ficam 30 dias; depois somem (o log do sistema continua sendo a fonte original). */
export const ERROR_RETENTION_DAYS = 30;
const LOG_LINES = 300;
/** Quantas linhas de erro já vistas guardamos por sistema para não contá-las de novo. */
const MAX_SEEN = 400;
const MAX_GROUPS_PER_SCAN = 50;
const CONCURRENCY = 3;

type AppRow = Awaited<ReturnType<typeof loadApps>>[number];

function loadApps() {
  return prisma.application.findMany({ where: { status: { not: "STOPPED" }, provider: { enabled: true } }, include: { provider: true }, orderBy: { name: "asc" } });
}

/**
 * Lê o log de UM sistema e grava só as ocorrências novas, agrupadas. A PRIMEIRA leitura de um sistema só marca o ponto de
 * partida (não cria grupos): senão os erros antigos do final do log pareceriam "erros novos de hoje".
 */
export async function collectApplicationErrors(app: AppRow, now: Date): Promise<number> {
  const provider = createDeploymentProvider(app.provider);
  const result = await provider.getApplicationLogs(app.externalId, app.resourceType, { lines: LOG_LINES });
  const events = extractErrorEvents(result.lines.map((l) => l.raw));
  const state = await prisma.errorScanState.findUnique({ where: { applicationId: app.id } });
  const seenNow = events.map((e) => e.identity).slice(-MAX_SEEN);

  let recorded = 0;
  if (state) {
    const fresh = onlyNew(events, new Set(state.seen));
    for (const g of groupEvents(fresh).slice(0, MAX_GROUPS_PER_SCAN)) {
      const sample = redactSecrets(g.sample).slice(0, MAX_SAMPLE_CHARS);
      await prisma.errorGroup.upsert({
        where: { applicationId_fingerprint: { applicationId: app.id, fingerprint: g.fingerprint } },
        create: { applicationId: app.id, fingerprint: g.fingerprint, sample, count: g.count, firstSeenAt: now, lastSeenAt: now },
        update: { sample, count: { increment: g.count }, lastSeenAt: now },
      });
      recorded += g.count;
    }
  }
  await prisma.errorScanState.upsert({ where: { applicationId: app.id }, create: { applicationId: app.id, seen: seenNow, scannedAt: now }, update: { seen: seenNow, scannedAt: now } });
  return recorded;
}

/** Chamado a cada 15 min pelo servidor. Falha de um sistema (Coolify fora, log indisponível) nunca derruba os outros. */
export async function runErrorCollectorTick(now: Date = new Date()): Promise<{ apps: number; errors: number; failed: number }> {
  const apps = await loadApps();
  let errors = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const app = apps[next++];
      if (!app) return;
      try {
        errors += await collectApplicationErrors(app, now);
      } catch (error) {
        failed += 1;
        logger.warn("error_collect_failed", { applicationId: app.id, message: error instanceof Error ? redactSecrets(error.message).slice(0, 200) : "falhou" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, apps.length) }, worker));
  await prisma.errorGroup.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - ERROR_RETENTION_DAYS * 24 * 3600_000) } } });
  if (errors) logger.info("error_collect_done", { apps: apps.length, errors, failed });
  return { apps: apps.length, errors, failed };
}

export interface ErrorGroupView {
  id: string;
  applicationId: string;
  application: string;
  project: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sample: string;
}

/** Erros dos sistemas vistos nas últimas `hours` horas (mais recentes primeiro). Usado pelas ferramentas dos agentes e pelo painel. */
export async function listErrorGroups(options: { hours?: number; system?: string; limit?: number } = {}): Promise<ErrorGroupView[]> {
  const since = new Date(Date.now() - (options.hours ?? 24) * 3600_000);
  const rows = await prisma.errorGroup.findMany({
    where: { lastSeenAt: { gte: since }, ...(options.system ? { application: { name: { contains: options.system, mode: "insensitive" } } } : {}) },
    include: { application: { select: { name: true, project: { select: { name: true } } } } },
    orderBy: [{ lastSeenAt: "desc" }, { count: "desc" }],
    take: Math.min(Math.max(options.limit ?? 30, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.applicationId,
    application: r.application.name,
    project: r.application.project?.name ?? null,
    count: r.count,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    sample: r.sample,
  }));
}
