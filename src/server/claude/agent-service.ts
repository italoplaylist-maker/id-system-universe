import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { NotFoundError, UnauthorizedLikeError, ValidationError } from "@/lib/errors";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { hashAgentToken } from "@/server/monitoring/server-service";

type Actor = { userId: string; ip?: string; userAgent?: string };

/** Após este tempo sem eventos uma sessão "trabalhando" vira "ociosa"; após o segundo, some da sala. */
export const WORKING_STALE_MS = 3 * 60_000;
export const SESSION_VISIBLE_MS = 30 * 60_000;
export const RETENTION_DAYS = 3;

export type AgentState = "WORKING" | "IDLE" | "ERROR" | "APPROVAL";

/** O hook espera a decisão por até ~270 s; depois cai para o diálogo normal do Claude. */
export const APPROVAL_TTL_MS = 290_000;

// ---------------------------------------------------------------------------
// Privacidade: o hook já envia só o essencial; aqui removemos o que parece segredo.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|ghp|gho|ghs|github_pat|xox[abp]|isu|AKIA)[-_][A-Za-z0-9_\-]{12,}/g,
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Z0-9_]*)=\S+/gi,
  /(:\/\/[^\s:@/]+:)[^\s@/]+@/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0], "[segredo]").replace(SECRET_PATTERNS[1], "Bearer [segredo]").replace(SECRET_PATTERNS[2], "$1=[segredo]").replace(SECRET_PATTERNS[3], "$1[segredo]@");
  return out;
}

// ---------------------------------------------------------------------------
// Fontes (feeds) e tokens
// ---------------------------------------------------------------------------

const nameSchema = z.object({ name: z.string().trim().min(2, "Informe o nome da fonte.").max(80) });
const newToken = () => `isc_${randomBytes(24).toString("hex")}`;

export async function createFeed(input: unknown, actor: Actor): Promise<{ id: string; name: string; token: string }> {
  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const token = newToken();
  const feed = await prisma.agentFeed.create({ data: { name: parsed.data.name, tokenHash: hashAgentToken(token) } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_FEED_CREATED", status: "SUCCESS", entityType: "AgentFeed", entityId: feed.id, metadata: { name: feed.name }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return { id: feed.id, name: feed.name, token };
}

export async function rotateFeedToken(id: string, actor: Actor): Promise<{ token: string }> {
  if (!(await prisma.agentFeed.findUnique({ where: { id } }))) throw new NotFoundError("Fonte não encontrada.");
  const token = newToken();
  await prisma.agentFeed.update({ where: { id }, data: { tokenHash: hashAgentToken(token) } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_FEED_TOKEN_ROTATED", status: "SUCCESS", entityType: "AgentFeed", entityId: id, ipAddress: actor.ip, userAgent: actor.userAgent });
  return { token };
}

export async function deleteFeed(id: string, actor: Actor): Promise<void> {
  const feed = await prisma.agentFeed.findUnique({ where: { id } });
  if (!feed) throw new NotFoundError("Fonte não encontrada.");
  await prisma.agentFeed.delete({ where: { id } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_FEED_DELETED", status: "SUCCESS", entityType: "AgentFeed", entityId: id, metadata: { name: feed.name }, ipAddress: actor.ip, userAgent: actor.userAgent });
}

export async function listFeeds() {
  const feeds = await prisma.agentFeed.findMany({ orderBy: { createdAt: "asc" }, include: { sessions: { select: { lastEventAt: true }, orderBy: { lastEventAt: "desc" }, take: 1 } } });
  return feeds.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt.toISOString(), lastEventAt: f.sessions[0]?.lastEventAt.toISOString() ?? null }));
}

async function feedByToken(token: string) {
  if (!/^isc_[0-9a-f]{48}$/.test(token)) throw new UnauthorizedLikeError();
  const feed = await prisma.agentFeed.findUnique({ where: { tokenHash: hashAgentToken(token) } });
  if (!feed) throw new UnauthorizedLikeError();
  return feed;
}

// ---------------------------------------------------------------------------
// Ingestão
// ---------------------------------------------------------------------------

export const hookEventSchema = z.object({
  sessionId: z.string().min(1).max(120),
  event: z.enum(["session_start", "prompt", "tool_start", "tool_end", "stop", "notify", "session_end", "permission_request"]),
  tool: z.string().max(60).optional(),
  target: z.string().max(200).optional(),
  /** Só em permission_request: o que o Claude quer executar (comando/arquivo), para você decidir com informação. */
  detail: z.string().max(500).optional(),
  ok: z.boolean().optional(),
  repo: z.string().max(160).optional(),
  branch: z.string().max(120).optional(),
  model: z.string().max(80).optional(),
  /** Epoch ms no momento do hook — eventos chegam fora de ordem (cada hook envia em paralelo). */
  at: z.number().int().positive().optional(),
  /** O hook está esperando a resposta e sabe entregar um pedido pendente ao Claude. */
  deliver: z.boolean().optional(),
});

export async function ingestHookEvent(token: string, body: unknown): Promise<{ ok: true; pending: boolean; command?: string; approvalId?: string }> {
  const feed = await feedByToken(token);
  // Folga grande: uma sessão ativa dispara dezenas de eventos por minuto.
  consumeRateLimit(`claude:${feed.id}`, 900, 60_000);
  const parsed = hookEventSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError(`Evento inválido: ${parsed.error.issues[0]?.path.join(".") ?? ""}`.trim());
  const e = parsed.data;
  const target = e.target ? redactSecrets(e.target) : undefined;
  const now = new Date();

  const phase = e.event === "session_end" ? "ENDED" : e.event === "stop" || e.event === "notify" ? "WAITING" : "WORKING";
  const failed = e.event === "tool_end" && e.ok === false;
  // O relógio do hook manda, limitado ao futuro próximo — um relógio errado não congela a sessão.
  const at = e.at && e.at <= now.getTime() + 60_000 ? new Date(e.at) : now;
  const session = await prisma.agentSession.upsert({
    where: { feedId_externalId: { feedId: feed.id, externalId: e.sessionId } },
    create: { feedId: feed.id, externalId: e.sessionId, repo: e.repo, branch: e.branch, model: e.model, startedAt: at, lastEventAt: at },
    update: {},
  });

  // 1) metadados e contadores: sempre aplicados, independem da ordem (só campos informados).
  await prisma.agentSession.update({
    where: { id: session.id },
    data: {
      ...(e.repo ? { repo: e.repo } : {}),
      ...(e.branch ? { branch: e.branch } : {}),
      ...(e.model ? { model: e.model } : {}),
      ...(e.event === "tool_end" ? { toolCount: { increment: 1 }, failedCount: { increment: failed ? 1 : 0 } } : {}),
    },
  });
  // 2) estado atual: só se este evento for mais novo que o último já aplicado.
  await prisma.agentSession.updateMany({
    where: { id: session.id, lastEventAt: { lte: at } },
    data: {
      phase,
      lastEventAt: at,
      endedAt: phase === "ENDED" ? at : null,
      ...(e.event === "tool_start" || e.event === "tool_end" ? { lastTool: e.tool ?? session.lastTool, lastTarget: target ?? null } : {}),
      ...(e.event === "tool_start" || e.event === "prompt" ? { lastToolFailed: false } : {}),
      ...(e.event === "tool_end" ? { lastToolFailed: failed } : {}),
    },
  });
  // tool_start só move o estado; o histórico guarda o resultado (tool_end) e os marcos da sessão.
  if (e.event !== "tool_start") {
    await prisma.agentEvent.create({ data: { sessionId: session.id, ts: at, kind: e.event, tool: e.tool, target, ok: e.ok ?? true } });
  }
  if (e.event === "session_end") return { ok: true, pending: false };
  if (e.event === "permission_request") {
    // Um pedido novo substitui os anteriores ainda abertos desta sessão (o Claude só pergunta uma coisa por vez).
    await prisma.agentApproval.updateMany({ where: { sessionId: session.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: now } });
    const approval = await prisma.agentApproval.create({ data: { sessionId: session.id, tool: e.tool ?? "Ferramenta", detail: redactSecrets(e.detail ?? e.target ?? "").slice(0, 500) } });
    return { ok: true, pending: false, approvalId: approval.id };
  }
  // Pedidos do painel: entregues só a quem está esperando a resposta (e sabe repassar ao Claude).
  if (e.deliver) {
    const command = await claimPendingCommands(session.id);
    if (command) return { ok: true, pending: false, command };
  }
  return { ok: true, pending: (await prisma.agentCommand.count({ where: { sessionId: session.id, status: "PENDING" } })) > 0 };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface AgentSessionView {
  id: string;
  feedName: string;
  repo: string | null;
  branch: string | null;
  model: string | null;
  state: AgentState;
  /** Texto curto do que está fazendo agora, ex.: "Edit · src/app.ts". */
  activity: string | null;
  toolCount: number;
  failedCount: number;
  startedAt: string;
  lastEventAt: string;
  /** Pedido de permissão aguardando você decidir (o mais antigo ainda válido). */
  approval: { id: string; tool: string; detail: string; createdAt: string } | null;
  /** Funcionário permanente da Central (perfil do orquestrador): nome próprio e estado de sala detalhado. */
  profile?: { title: string; roomState: "AVAILABLE" | "RECEIVING" | "RUNNING" | "WAITING" | "DONE" | "ERROR" | "PAUSED"; queued: number };
}

export function deriveAgentState(s: { phase: string; lastToolFailed: boolean; lastEventAt: Date }, now: Date, hasPendingApproval = false): AgentState | "ENDED" {
  if (s.phase === "ENDED" || now.getTime() - s.lastEventAt.getTime() > SESSION_VISIBLE_MS) return "ENDED";
  if (hasPendingApproval) return "APPROVAL";
  if (s.phase === "WAITING") return "IDLE";
  if (now.getTime() - s.lastEventAt.getTime() > WORKING_STALE_MS) return "IDLE";
  return s.lastToolFailed ? "ERROR" : "WORKING";
}

async function pendingApprovalsBySession(sessionIds: string[], now: Date) {
  const rows = await prisma.agentApproval.findMany({
    where: { sessionId: { in: sessionIds }, status: "PENDING", createdAt: { gte: new Date(now.getTime() - APPROVAL_TTL_MS) } },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, AgentSessionView["approval"]>();
  for (const r of rows) if (!map.has(r.sessionId)) map.set(r.sessionId, { id: r.id, tool: r.tool, detail: r.detail, createdAt: r.createdAt.toISOString() });
  return map;
}

type SessionRow = Awaited<ReturnType<typeof prisma.agentSession.findMany<{ include: { feed: { select: { name: true } } } }>>>[number];

function toSessionView(r: SessionRow, state: AgentState, approval: AgentSessionView["approval"]): AgentSessionView {
  return {
    id: r.id,
    feedName: r.feed.name,
    repo: r.repo,
    branch: r.branch,
    model: r.model,
    state,
    activity: r.lastTool ? (r.lastTarget ? `${r.lastTool} · ${r.lastTarget}` : r.lastTool) : null,
    toolCount: r.toolCount,
    failedCount: r.failedCount,
    startedAt: r.startedAt.toISOString(),
    lastEventAt: r.lastEventAt.toISOString(),
    approval,
  };
}

export async function listActiveSessions(now: Date = new Date()): Promise<AgentSessionView[]> {
  const rows = await prisma.agentSession.findMany({
    where: { phase: { not: "ENDED" }, lastEventAt: { gte: new Date(now.getTime() - SESSION_VISIBLE_MS) } },
    include: { feed: { select: { name: true } } },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const approvals = await pendingApprovalsBySession(rows.map((r) => r.id), now);
  const result: AgentSessionView[] = [];
  for (const r of rows) {
    const approval = approvals.get(r.id) ?? null;
    const state = deriveAgentState(r, now, approval !== null);
    if (state === "ENDED") continue;
    result.push(toSessionView(r, state, approval));
  }
  return result;
}

export interface AgentTimelineItem {
  id: string;
  ts: string;
  kind: string;
  tool: string | null;
  target: string | null;
  ok: boolean;
}

export async function getSessionTimeline(id: string, limit = 80): Promise<{ session: AgentSessionView; events: AgentTimelineItem[] }> {
  const now = new Date();
  const row = await prisma.agentSession.findUnique({ where: { id }, include: { feed: { select: { name: true } } } });
  if (!row) throw new NotFoundError("Sessão não encontrada.");
  const events = await prisma.agentEvent.findMany({ where: { sessionId: id }, orderBy: { ts: "desc" }, take: Math.min(limit, 200) });
  const approval = (await pendingApprovalsBySession([id], now)).get(id) ?? null;
  const state = deriveAgentState(row, now, approval !== null);
  return {
    session: toSessionView(row, state === "ENDED" ? "IDLE" : state, approval),
    events: events.map((e) => ({ id: e.id, ts: e.ts.toISOString(), kind: e.kind, tool: e.tool, target: e.target, ok: e.ok })),
  };
}

export async function pruneAgentData(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const sessions = await prisma.agentSession.deleteMany({ where: { lastEventAt: { lt: cutoff } } });
  const events = await prisma.agentEvent.deleteMany({ where: { ts: { lt: cutoff } } });
  return sessions.count + events.count;
}

// ---------------------------------------------------------------------------
// Pedidos do painel para sessões ativas (somente quem tem permissão de escrita)
// ---------------------------------------------------------------------------

export interface AgentCommandView {
  id: string;
  text: string;
  status: "PENDING" | "DELIVERED" | "CANCELLED";
  createdAt: string;
  deliveredAt: string | null;
}

const commandSchema = z.object({ text: z.string().trim().min(1, "Escreva o pedido.").max(2000, "O pedido pode ter no máximo 2000 caracteres.") });
const MAX_PENDING_PER_SESSION = 5;
const MAX_DELIVERED_CHARS = 4000;

function toView(c: { id: string; text: string; status: string; createdAt: Date; deliveredAt: Date | null }): AgentCommandView {
  return { id: c.id, text: c.text, status: c.status as AgentCommandView["status"], createdAt: c.createdAt.toISOString(), deliveredAt: c.deliveredAt?.toISOString() ?? null };
}

export async function queueCommand(sessionId: string, input: unknown, actor: Actor): Promise<AgentCommandView> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  consumeRateLimit(`agent-command:${actor.userId}`, 20, 60_000);
  const session = await prisma.agentSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError("Sessão não encontrada.");
  if (deriveAgentState(session, new Date()) === "ENDED") throw new ValidationError("Esta sessão já terminou — o pedido não chegaria a ninguém.");
  if ((await prisma.agentCommand.count({ where: { sessionId, status: "PENDING" } })) >= MAX_PENDING_PER_SESSION) {
    throw new ValidationError("Já há pedidos demais na fila desta sessão. Aguarde a entrega ou cancele algum.");
  }
  const command = await prisma.agentCommand.create({ data: { sessionId, text: parsed.data.text, createdById: actor.userId } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_COMMAND_QUEUED", status: "SUCCESS", entityType: "AgentSession", entityId: sessionId, metadata: { length: parsed.data.text.length }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return toView(command);
}

export async function listCommands(sessionId: string): Promise<AgentCommandView[]> {
  const rows = await prisma.agentCommand.findMany({ where: { sessionId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 10 });
  return rows.map(toView);
}

export async function cancelCommand(sessionId: string, commandId: string): Promise<void> {
  const result = await prisma.agentCommand.updateMany({ where: { id: commandId, sessionId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (result.count === 0) throw new NotFoundError("Pedido não encontrado ou já entregue.");
}

/** Entrega atômica: cada pedido chega ao Claude exatamente uma vez, mesmo com dois hooks concorrentes. */
export async function claimPendingCommands(sessionId: string): Promise<string | null> {
  const pending = await prisma.agentCommand.findMany({ where: { sessionId, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: MAX_PENDING_PER_SESSION });
  const claimed: string[] = [];
  let size = 0;
  for (const c of pending) {
    if (claimed.length > 0 && size + c.text.length > MAX_DELIVERED_CHARS) break;
    const won = await prisma.agentCommand.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    if (won.count === 1) {
      claimed.push(c.text);
      size += c.text.length;
    }
  }
  if (claimed.length === 0) return null;
  const body = claimed.length === 1 ? claimed[0] : claimed.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `[Pedido enviado pelo painel ID System Universe]\n${body}`;
}

// ---------------------------------------------------------------------------
// Aprovações: o hook PermissionRequest espera a sua decisão aqui
// ---------------------------------------------------------------------------

/** Consulta do hook (autenticada pelo token da fonte): só enxerga aprovações das próprias sessões. */
export async function getApprovalForHook(token: string, approvalId: string): Promise<{ status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" }> {
  const feed = await feedByToken(token);
  const a = await prisma.agentApproval.findFirst({ where: { id: approvalId, session: { feedId: feed.id } } });
  if (!a) throw new NotFoundError("Aprovação não encontrada.");
  if (a.status === "PENDING" && Date.now() - a.createdAt.getTime() > APPROVAL_TTL_MS) return { status: "EXPIRED" };
  return { status: a.status as "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" };
}

export async function decideApproval(approvalId: string, input: unknown, actor: Actor): Promise<{ status: "APPROVED" | "DENIED" }> {
  const parsed = z.object({ decision: z.enum(["allow", "deny"]) }).safeParse(input);
  if (!parsed.success) throw new ValidationError("Decisão inválida.");
  consumeRateLimit(`agent-approval:${actor.userId}`, 60, 60_000);
  const a = await prisma.agentApproval.findUnique({ where: { id: approvalId } });
  if (!a) throw new NotFoundError("Aprovação não encontrada.");
  const status = parsed.data.decision === "allow" ? "APPROVED" : "DENIED";
  // Só decide uma vez, e só enquanto o hook ainda está esperando.
  const won = await prisma.agentApproval.updateMany({
    where: { id: approvalId, status: "PENDING", createdAt: { gte: new Date(Date.now() - APPROVAL_TTL_MS) } },
    data: { status, decidedById: actor.userId, decidedAt: new Date() },
  });
  if (won.count === 0) throw new ValidationError("Este pedido já foi decidido ou expirou — o Claude voltou a perguntar na própria sessão.");
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_APPROVAL_DECIDED", status: "SUCCESS", entityType: "AgentSession", entityId: a.sessionId, metadata: { tool: a.tool, decision: status }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return { status };
}
