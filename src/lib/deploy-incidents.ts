/**
 * Incidente de deploy falho — lógica PURA (sem banco): como achar o PR/agente culpado pelo commit, quando abrir/repetir/escalar,
 * o texto da tarefa do Manager e, principalmente, QUEM pode mergear a correção. Tudo testado sem rede.
 */

/** Quantos deploys podem falhar dentro de um incidente (o original + correções que também falham) antes de chamar um humano. */
export const MAX_INCIDENT_ATTEMPTS = 3;
/** Incidente aberto há mais que isto sem resolver vira "precisa de humano" (e o agente bloqueado continua bloqueado). */
export const INCIDENT_TIMEOUT_HOURS = 6;

/** "Título do PR (#123)" (squash do GitHub) ou "Merge pull request #123 from …" → 123. */
export function prNumberFromCommitMessage(message: string | null | undefined): number | null {
  const first = (message ?? "").split("\n")[0].trim();
  const squash = first.match(/\(#(\d+)\)\s*$/);
  if (squash) return Number(squash[1]);
  const merge = first.match(/^Merge pull request #(\d+)\b/i);
  return merge ? Number(merge[1]) : null;
}

/** "dono/nome", "https://github.com/dono/nome(.git)" e "Dono/Nome" são o mesmo repositório. */
export function normalizeRepo(repo: string | null | undefined): string {
  return (repo ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}
export const sameRepo = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normalizeRepo(a);
  return x !== "" && x === normalizeRepo(b);
};

export type IncidentDecision = { kind: "new" } | { kind: "retry"; attempts: number } | { kind: "escalate"; attempts: number };

/** Um deploy falhou: abre incidente novo, conta mais uma tentativa no que já está aberto ou escala para um humano. */
export function decideOnFailure(open: { attempts: number } | null): IncidentDecision {
  if (!open) return { kind: "new" };
  const attempts = open.attempts + 1;
  return attempts > MAX_INCIDENT_ATTEMPTS ? { kind: "escalate", attempts } : { kind: "retry", attempts };
}

export const incidentTooOld = (createdAt: Date, now: Date): boolean => now.getTime() - createdAt.getTime() >= INCIDENT_TIMEOUT_HOURS * 3600_000;

/** Final do log (o erro costuma estar no fim), limitado em linhas e caracteres. */
export function logTail(lines: string[], maxLines = 60, maxChars = 6000): string {
  const tail = lines.slice(-maxLines).join("\n");
  return tail.length > maxChars ? `[… início omitido …]\n${tail.slice(tail.length - maxChars)}` : tail;
}

export interface IncidentBrief {
  application: string;
  repository: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  prNumber: number | null;
  culpritAgent: string | null;
  attempts: number;
  /** Final do log do deploy, ou o motivo de ele não estar disponível. */
  logTail: string | null;
  logNote: string | null;
  previousSummary: string | null;
}

/** Instrução da tarefa urgente do ID Manager. É o que ele lê: precisa ser completa, pois o Manager não vê mais nada além disto e das ferramentas. */
export function buildManagerBrief(b: IncidentBrief): string {
  const sha = b.commitSha ? b.commitSha.slice(0, 7) : "desconhecido";
  const parts = [
    `INCIDENTE DE DEPLOY — o deploy de "${b.application}" FALHOU${b.attempts > 1 ? ` (tentativa ${b.attempts} de ${MAX_INCIDENT_ATTEMPTS}: a correção anterior também falhou)` : ""}.`,
    `Repositório: ${b.repository ?? "não informado"} · commit ${sha}${b.commitMessage ? ` — ${b.commitMessage.split("\n")[0]}` : ""}${b.prNumber ? ` (PR #${b.prNumber})` : ""}.`,
    b.culpritAgent ? `O commit veio do agente "${b.culpritAgent}": ele foi BLOQUEADO até o incidente fechar (não publica nem mergeia). Não o acione.` : "Não foi possível ligar o commit a um agente.",
    b.previousSummary ? `O que já foi tentado: ${b.previousSummary}` : "",
    b.logTail ? `FINAL DO LOG DO DEPLOY:\n${b.logTail}` : `Log do deploy indisponível: ${b.logNote ?? "motivo desconhecido"}. Use listar_erros e ler_logs e reproduza o build/testes na cópia do repositório.`,
    "",
    "O QUE FAZER (você tem AUTORIDADE para resolver, sem pedir permissão):",
    "1. Classifique a causa pelo log: erro de CÓDIGO/teste/tipos/migração → delegue ao ID Doctor; falta de memória/disco, Docker, variável de ambiente ou Coolify → delegue ao ID DevOps. Use delegar_tarefa com prioridade alta e uma instrução completa (repositório, commit, log, o que entregar).",
    "2. O especialista achará a causa raiz, corrigirá com a menor mudança possível e um teste, abrirá o PR com publish_changes e, quando o CI estiver verde, fará o merge com merge_pull_request (neste incidente isso é permitido para quem você delegar).",
    "3. Acompanhe com resultado_delegacoes. Se o resultado disser que o problema é do ambiente e não do código, delegue ao DevOps.",
    "Regras que continuam valendo: nada de force-push, nada de apagar dados, nada de mexer em credenciais, nada de migração destrutiva. O merge exige CI verde. Seja econômico: não repita análise já feita.",
  ];
  return parts.filter((p) => p !== "").join("\n");
}

/**
 * Quem pode mergear: SÓ dentro de um incidente aberto, no repositório do sistema que falhou, e só o Manager desse incidente
 * ou um agente a quem ele delegou. Qualquer outra situação continua proibida para a equipe CLT.
 */
export function mayMergeForIncident(i: {
  agentId: string;
  prRepo: string;
  incident: { status: string; applicationRepo: string | null; commitRepo: string | null; managerAgentId: string | null } | null;
  delegatedAgentIds: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (!i.incident || i.incident.status !== "OPEN") return { ok: false, reason: "Agentes da equipe CLT só fazem merge para consertar um incidente de deploy aberto pelo Universe. Não há incidente aberto para este repositório: abra o PR e deixe o merge para o Italo." };
  const repoOk = sameRepo(i.prRepo, i.incident.applicationRepo) || sameRepo(i.prRepo, i.incident.commitRepo);
  if (!repoOk) return { ok: false, reason: "Este PR não é do repositório do sistema que falhou no incidente aberto." };
  const fixer = i.agentId === i.incident.managerAgentId || i.delegatedAgentIds.includes(i.agentId);
  if (!fixer) return { ok: false, reason: "Você não faz parte do conserto deste incidente (o ID Manager precisa delegá-lo a você)." };
  return { ok: true };
}
