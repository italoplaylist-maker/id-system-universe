import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { attachmentsDir, purgeAttachments } from "./attachments";
import { workspaceRoot } from "./workspace";
import { cleanupWorkspace } from "./git/ops";

/**
 * Faxina do servidor: o Universe roda agentes que clonam repositórios, instalam dependências, compilam e guardam
 * transcrições. Nada disso se apaga sozinho. Este módulo mede o que ocupa espaço e remove, com segurança,
 * só o que é REGENERÁVEL ou já está guardado em outro lugar (Git, banco).
 */

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const RETENTION = {
  /** Pastas pesadas (node_modules, .next…) de um agente parado há mais que isto são apagadas — voltam sozinhas com npm install/build. */
  heavyIdleHours: () => num("AGENT_HEAVY_IDLE_HOURS", 6),
  /** A cópia inteira (limpa e já enviada ao GitHub) de um agente parado há mais que isto é removida; o clone volta na próxima tarefa. */
  workspaceIdleDays: () => num("AGENT_WORKSPACE_IDLE_DAYS", 14),
  /** Transcrições do Claude (sessões) antigas que nenhum agente retoma. */
  transcriptDays: () => num("CLAUDE_TRANSCRIPT_DAYS", 21),
  /** Eventos detalhados de tarefas já encerradas (a tarefa e o resultado ficam). */
  taskEventDays: () => num("AGENT_EVENT_DAYS", 14),
  /** Registros de "sincronização concluída" (1 por minuto) e demais eventos do Universe. */
  syncEventDays: () => num("UNIVERSE_SYNC_EVENT_DAYS", 2),
  universeEventDays: () => num("UNIVERSE_EVENT_DAYS", 45),
};

/** Pastas regeneráveis. Só são apagadas se o Git as ignora (nunca arquivos versionados). */
export const HEAVY_DIRS = ["node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache", "dist", "build", "out", "coverage", "target", ".gradle", "__pycache__", ".pytest_cache", ".venv", "venv", ".expo"];

/** Dentro de ~/.claude só estas pastas de cache/telemetria são podadas (por idade). Credenciais, skills, plugins e settings nunca são tocados. */
const CLAUDE_CACHE_DIRS = ["file-history", "shell-snapshots", "debug", "todos", "statsig", "telemetry", "cache", "paste-cache", "image-cache", "session-env"];

export const claudeHome = () => join(homedir(), ".claude");

/** Tamanho total em bytes (não segue links simbólicos). */
export async function dirSize(path: string): Promise<number> {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += (await lstat(p)).size;
      } catch {
        // some entre a listagem e o lstat: ignora
      }
    }
  }
  return total;
}

function isGitIgnored(cwd: string, rel: string): Promise<boolean> {
  return new Promise((res) => {
    execFile("git", ["check-ignore", "-q", "--", rel], { cwd, timeout: 15_000 }, (err) => res(!err));
  });
}

function hasOrigin(cwd: string): Promise<boolean> {
  return new Promise((res) => {
    execFile("git", ["remote", "get-url", "origin"], { cwd, timeout: 15_000 }, (err) => res(!err));
  });
}

async function insideRoot(path: string, root: string): Promise<boolean> {
  const p = resolve(path);
  const r = resolve(root);
  return p !== r && p.startsWith(r + sep);
}

const ACTIVE = ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL"] as const;

async function agentState() {
  const [agents, active, last] = await Promise.all([
    prisma.agentProfile.findMany({ select: { id: true, name: true, cwd: true, claudeSessionId: true, archivedAt: true } }),
    prisma.agentTask.findMany({ where: { status: { in: [...ACTIVE] } }, select: { agentId: true } }),
    prisma.agentTask.groupBy({ by: ["agentId"], _max: { createdAt: true, finishedAt: true } }),
  ]);
  const busy = new Set(active.map((a) => a.agentId));
  const lastActivity = new Map<string, number>();
  for (const l of last) {
    const t = Math.max(l._max.createdAt?.getTime() ?? 0, l._max.finishedAt?.getTime() ?? 0);
    lastActivity.set(l.agentId, t);
  }
  return { agents, busy, lastActivity };
}

/** Candidatas a "pasta pesada": na raiz da cópia e um nível abaixo (apps/*, packages/*, etc.). */
async function heavyCandidates(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const scan = async (dir: string, relBase: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory() && HEAVY_DIRS.includes(e.name)) out.push(relBase ? `${relBase}/${e.name}` : e.name);
  };
  await scan(cwd, "");
  let top;
  try {
    top = await readdir(cwd, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of top) if (e.isDirectory() && !e.name.startsWith(".") && !HEAVY_DIRS.includes(e.name)) await scan(join(cwd, e.name), e.name);
  return out;
}

export interface StorageReport {
  workspaces: { path: string; bytes: number; agents: Array<{ agentId: string; name: string; bytes: number; heavyBytes: number; idleHours: number | null; busy: boolean }>; orphanBytes: number };
  claude: { path: string; bytes: number; transcriptsBytes: number };
  attachments: { bytes: number };
  database: { taskEvents: number; universeEvents: number; syncEvents: number };
  memory: { rssMB: number; heapUsedMB: number };
  totalBytes: number;
}

export async function getStorageReport(): Promise<StorageReport> {
  const root = workspaceRoot();
  const { agents, busy, lastActivity } = await agentState();
  const now = Date.now();
  const rows: StorageReport["workspaces"]["agents"] = [];
  let known = 0;
  const knownPaths = new Set<string>();
  for (const a of agents) {
    if (!existsSync(a.cwd) || !(await insideRoot(a.cwd, root))) continue;
    knownPaths.add(resolve(a.cwd));
    const bytes = await dirSize(a.cwd);
    let heavyBytes = 0;
    for (const rel of await heavyCandidates(a.cwd)) heavyBytes += await dirSize(join(a.cwd, rel));
    known += bytes;
    const la = lastActivity.get(a.id);
    rows.push({ agentId: a.id, name: a.name, bytes, heavyBytes, idleHours: la ? Math.round((now - la) / HOUR) : null, busy: busy.has(a.id) });
  }
  const rootBytes = existsSync(root) ? await dirSize(root) : 0;
  const claude = claudeHome();
  const transcripts = existsSync(join(claude, "projects")) ? await dirSize(join(claude, "projects")) : 0;
  const mem = process.memoryUsage();
  const [taskEvents, universeEvents, syncEvents] = await Promise.all([prisma.agentTaskEvent.count(), prisma.universeEvent.count(), prisma.universeEvent.count({ where: { type: "SYNC_COMPLETED" } })]);
  const claudeBytes = existsSync(claude) ? await dirSize(claude) : 0;
  const attachBytes = existsSync(attachmentsDir()) ? await dirSize(attachmentsDir()) : 0;
  return {
    workspaces: { path: root, bytes: rootBytes, agents: rows.sort((x, y) => y.bytes - x.bytes), orphanBytes: Math.max(0, rootBytes - known) },
    claude: { path: claude, bytes: claudeBytes, transcriptsBytes: transcripts },
    attachments: { bytes: attachBytes },
    database: { taskEvents, universeEvents, syncEvents },
    memory: { rssMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) },
    totalBytes: rootBytes + claudeBytes + attachBytes,
  };
}

export interface CleanupResult {
  freedBytes: number;
  actions: string[];
}

async function removeCounting(path: string, result: CleanupResult, label: string) {
  const bytes = await dirSize(path).catch(() => 0);
  await rm(path, { recursive: true, force: true });
  result.freedBytes += bytes;
  result.actions.push(`${label} (${Math.round(bytes / 1048576)} MB)`);
}

/**
 * Faxina segura. `force` ignora o tempo de ociosidade das pastas pesadas (botão "Limpar agora"); a cópia inteira
 * e as transcrições respeitam sempre as regras de idade. Nada é apagado de agente com tarefa ativa.
 */
export async function cleanupStorage(opts: { force?: boolean } = {}): Promise<CleanupResult> {
  const result: CleanupResult = { freedBytes: 0, actions: [] };
  const root = workspaceRoot();
  const now = Date.now();
  const { agents, busy, lastActivity } = await agentState();

  // 1) Pastas regeneráveis (e ignoradas pelo Git) de agentes parados.
  for (const a of agents) {
    if (busy.has(a.id) || !existsSync(a.cwd) || !(await insideRoot(a.cwd, root))) continue;
    const idleMs = now - (lastActivity.get(a.id) ?? 0);
    if (!opts.force && idleMs < RETENTION.heavyIdleHours() * HOUR) continue;
    for (const rel of await heavyCandidates(a.cwd)) {
      if (!(await isGitIgnored(a.cwd, rel))) continue; // versionada: nunca
      await removeCounting(join(a.cwd, rel), result, `${a.name}: ${rel}`);
    }
  }

  // 2) Cópia inteira de quem está parado há muito tempo (só se limpa e enviada — cleanupWorkspace confere).
  for (const a of agents) {
    if (busy.has(a.id) || !existsSync(a.cwd)) continue;
    const la = lastActivity.get(a.id);
    // Sem histórico de tarefas = não sei desde quando está parado: nunca apaga a cópia inteira.
    if (!la || now - la < RETENTION.workspaceIdleDays() * DAY) continue;
    // Só quem tem o GitHub como origem (o que está lá é recuperável); cópia só local nunca é removida.
    if (!(await hasOrigin(a.cwd))) continue;
    const before = await dirSize(a.cwd).catch(() => 0);
    const r = await cleanupWorkspace(a.id).catch(() => ({ removed: false }));
    if (r.removed) {
      result.freedBytes += before;
      result.actions.push(`${a.name}: cópia inteira removida (${Math.round(before / 1048576)} MB; o clone volta na próxima tarefa)`);
    }
  }

  // 3) Pastas órfãs em workspaces (de agentes removidos) sem mexer há 30 dias.
  if (existsSync(root)) {
    const owned = new Set(agents.map((a) => resolve(a.cwd)));
    for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const p = resolve(join(root, e.name));
      if (owned.has(p)) continue;
      const st = await lstat(p).catch(() => null);
      if (st && now - st.mtimeMs > 30 * DAY) await removeCounting(p, result, `pasta órfã ${e.name}`);
    }
  }

  // 4) ~/.claude: transcrições antigas que nenhuma sessão ativa retoma + caches.
  const claude = claudeHome();
  const keepIds = new Set<string>(agents.map((a) => a.claudeSessionId).filter((x): x is string => !!x));
  const recent = await prisma.agentTask.findMany({ where: { claudeSessionId: { not: null }, createdAt: { gt: new Date(now - RETENTION.transcriptDays() * DAY) } }, select: { claudeSessionId: true } });
  recent.forEach((t) => t.claudeSessionId && keepIds.add(t.claudeSessionId));
  const projectsDir = join(claude, "projects");
  if (existsSync(projectsDir)) {
    for (const proj of await readdir(projectsDir, { withFileTypes: true }).catch(() => [])) {
      if (!proj.isDirectory()) continue;
      const dir = join(projectsDir, proj.name);
      for (const f of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const sid = f.name.replace(/\.jsonl$/, "");
        if (keepIds.has(sid)) continue;
        const p = join(dir, f.name);
        const st = await lstat(p).catch(() => null);
        if (!st || now - st.mtimeMs < RETENTION.transcriptDays() * DAY) continue;
        await removeCounting(p, result, `transcrição ${sid.slice(0, 8)}`);
      }
    }
  }
  for (const name of CLAUDE_CACHE_DIRS) {
    const dir = join(claude, name);
    if (!existsSync(dir)) continue;
    for (const f of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, f.name);
      const st = await lstat(p).catch(() => null);
      if (st && now - st.mtimeMs > 3 * DAY) await removeCounting(p, result, `${name}/${f.name.slice(0, 24)}`);
    }
  }

  // 5) Anexos órfãos/antigos e dados do banco.
  await purgeAttachments().catch(() => undefined);
  const ev = await prisma.agentTaskEvent.deleteMany({ where: { ts: { lt: new Date(now - RETENTION.taskEventDays() * DAY) }, task: { status: { in: ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"] } } } });
  const sync = await prisma.universeEvent.deleteMany({ where: { type: "SYNC_COMPLETED", createdAt: { lt: new Date(now - RETENTION.syncEventDays() * DAY) } } });
  const old = await prisma.universeEvent.deleteMany({ where: { createdAt: { lt: new Date(now - RETENTION.universeEventDays() * DAY) } } });
  if (ev.count + sync.count + old.count > 0) result.actions.push(`banco: ${ev.count} eventos de tarefas, ${sync.count + old.count} eventos do Universe`);

  logger.info("storage_cleanup", { freedMB: Math.round(result.freedBytes / 1048576), actions: result.actions.length });
  return result;
}
