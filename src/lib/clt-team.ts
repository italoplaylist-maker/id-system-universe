/**
 * AGENTES CLT — a equipe de funcionários de IA da ID System. Lógica PURA (sem banco, sem Claude): definição da equipe,
 * regras de segurança, roteamento determinístico de tarefas, detecção de duplicatas e orçamento de tokens.
 * Tudo aqui é testável sem rede; o Claude só entra quando a tarefa é de fato executada pelo worker do orquestrador.
 */

export const CLT_TEAM_ID = "CLT";

export type CltSlug = "id-manager" | "id-guardian" | "id-doctor" | "id-qa" | "id-optimizer" | "id-devops" | "id-architect";

export interface CltAgentDef {
  slug: CltSlug;
  name: string;
  roleTitle: string;
  specialty: string;
  description: string;
  /** Alias aceito pelo Claude Code ("opus" | "sonnet" | "haiku"): modelo mais barato que dá conta do cargo. */
  model: "opus" | "sonnet" | "haiku";
  effort: "low" | "medium" | "high";
  /** "plan" = só planeja; "default" = pede aprovação para ações sensíveis. Nenhum agente nasce com "bypassPermissions". */
  permissionMode: "default" | "plan";
  /** Limites iniciais de tokens (entrada + saída + cache) — ajustáveis por agente no painel. */
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  /** Palavras que indicam que a tarefa é deste cargo (roteamento sem gastar token). */
  keywords: string[];
}

/** Leitura e inspeção: liberadas sem pedir aprovação para todos. */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"];

/**
 * Regras de segurança OBRIGATÓRIAS (bloqueadas para todos os agentes CLT, sem exceção):
 * apagar dados/arquivos, migrations destrutivas, deploy/merge em produção, mexer em credenciais, push forçado.
 * Ações de produção só acontecem por aprovação humana no painel (o merge continua exigindo verificações verdes).
 */
export const CLT_DISALLOWED_TOOLS = [
  "Bash(rm:*)",
  "Bash(sudo:*)",
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git reset --hard:*)",
  "Bash(git clean:*)",
  "Bash(prisma migrate:*)",
  "Bash(npx prisma migrate:*)",
  "Bash(prisma db push:*)",
  "Bash(npx prisma db push:*)",
  "Bash(prisma migrate reset:*)",
  "Bash(psql:*)",
  "Bash(docker rm:*)",
  "Bash(docker rmi:*)",
  "Bash(docker system prune:*)",
  "Bash(docker volume rm:*)",
  "Bash(kubectl delete:*)",
  // Merge = deploy em produção: o agente abre o PR; quem faz o merge é um humano (botão no painel).
  "mcp__universe__merge_pull_request",
  "Read(.env)",
  "Read(.env.*)",
  "Edit(.env)",
  "Edit(.env.*)",
  "Write(.env)",
  "Write(.env.*)",
];

/** Regras de negócio que valem para qualquer tarefa de qualquer agente CLT (entram no prompt de sistema). */
export const CLT_RULES = [
  "Consulte o Cérebro do Brabo (CLAUDE.md dele) antes de qualquer alteração relevante e registre decisões e mudanças arquiteturais depois.",
  "Nunca execute migrations destrutivas, nunca apague dados de produção, nunca faça deploy de produção sem autorização humana.",
  "Nunca emita documentos fiscais reais, nunca altere valores financeiros e nunca modifique credenciais, tokens ou variáveis de ambiente.",
  "Acesse somente os repositórios autorizados a você; se precisar de outro, peça autorização em vez de tentar.",
  "Prefira análise incremental (git diff desde a última análise) a varrer o repositório inteiro; não repita trabalho já feito.",
  "Responda de forma curta, com o resultado e as pendências; qualquer ação de risco vira um pedido de aprovação.",
];

export const CLT_TEAM: CltAgentDef[] = [
  {
    slug: "id-manager",
    name: "ID Manager",
    roleTitle: "Gerente e orquestrador",
    specialty: "Coordenação da equipe",
    description:
      "Recebe pedidos, escolhe o agente certo, evita tarefas duplicadas, controla prioridades e o orçamento de tokens, acompanha a execução, consolida resultados e detecta falhas.",
    model: "sonnet",
    effort: "medium",
    permissionMode: "plan",
    dailyTokenLimit: 2_000_000,
    monthlyTokenLimit: 40_000_000,
    keywords: ["coorden", "priorid", "equipe", "relatório", "relatorio", "resumo geral", "distribu"],
  },
  {
    slug: "id-guardian",
    name: "ID Guardian",
    roleTitle: "Segurança",
    specialty: "Auditoria de segurança",
    description: "Audita segurança: vulnerabilidades, segredos expostos, autenticação/autorização, dependências com CVE e riscos de injeção.",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    dailyTokenLimit: 1_500_000,
    monthlyTokenLimit: 30_000_000,
    keywords: ["segurança", "seguranca", "vulnerab", "cve", "segredo", "secret", "credencial", "xss", "csrf", "injection", "auth", "permiss", "owasp", "token vazado"],
  },
  {
    slug: "id-doctor",
    name: "ID Doctor",
    roleTitle: "Diagnóstico e correção de bugs",
    specialty: "Diagnóstico de bugs",
    description: "Investiga a causa raiz de erros e falhas, corrige o código com a menor mudança possível e confirma que o problema não volta.",
    model: "opus",
    effort: "high",
    permissionMode: "default",
    dailyTokenLimit: 2_500_000,
    monthlyTokenLimit: 50_000_000,
    keywords: ["bug", "erro", "falha", "exception", "stack trace", "crash", "quebr", "500", "não funciona", "nao funciona", "corrig", "corrij", "diagnóstic", "diagnostic"],
  },
  {
    slug: "id-qa",
    name: "ID QA",
    roleTitle: "Testes e qualidade",
    specialty: "Testes automatizados",
    description: "Cria e roda testes, procura regressões, valida builds, lint e tipos, e relata o que não foi testado.",
    model: "sonnet",
    effort: "medium",
    permissionMode: "default",
    dailyTokenLimit: 1_500_000,
    monthlyTokenLimit: 30_000_000,
    keywords: ["test", "cobertura", "regress", "qualidade", "lint", "typecheck", "build", "e2e", "qa"],
  },
  {
    slug: "id-optimizer",
    name: "ID Optimizer",
    roleTitle: "Performance e banco de dados",
    specialty: "Performance e banco de dados",
    description: "Mede e melhora performance: consultas lentas, índices, memória, tempo de resposta e custo de renderização — sempre medindo antes e depois.",
    model: "sonnet",
    effort: "medium",
    permissionMode: "default",
    dailyTokenLimit: 1_500_000,
    monthlyTokenLimit: 30_000_000,
    keywords: ["performance", "lento", "lentidão", "otimiz", "query", "consulta", "índice", "indice", "memória", "memoria", "cpu", "latência", "latencia", "banco de dados", "fps"],
  },
  {
    slug: "id-devops",
    name: "ID DevOps",
    roleTitle: "Infraestrutura e deploy",
    specialty: "Infraestrutura e deploy",
    description: "Cuida de VPS, Docker, Coolify e pipelines: verifica a saúde da infraestrutura e prepara deploys — o deploy de produção só com autorização.",
    model: "sonnet",
    effort: "medium",
    permissionMode: "default",
    dailyTokenLimit: 1_500_000,
    monthlyTokenLimit: 30_000_000,
    keywords: ["deploy", "docker", "coolify", "servidor", "vps", "infra", "container", "contêiner", "traefik", "disco", "ci/cd", "pipeline", "dns", "ssl"],
  },
  {
    slug: "id-architect",
    name: "ID Architect",
    roleTitle: "Arquitetura e documentação",
    specialty: "Arquitetura e documentação",
    description: "Mantém a arquitetura coerente e a documentação (Cérebro do Brabo) fiel ao código: decisões, padrões, dependências entre sistemas.",
    model: "opus",
    effort: "high",
    permissionMode: "plan",
    dailyTokenLimit: 1_500_000,
    monthlyTokenLimit: 30_000_000,
    keywords: ["arquitet", "document", "cérebro", "cerebro", "decisão", "decisao", "refator", "design", "padrão", "padrao", "adr", "readme"],
  },
];

export const cltDef = (slug: string): CltAgentDef | undefined => CLT_TEAM.find((a) => a.slug === slug);

/** Ferramentas liberadas sem aprovação por padrão (somente leitura). */
export const cltAllowedTools = (): string[] => [...READ_ONLY_TOOLS];

// ---------------------------------------------------------------------------
// Roteamento determinístico (o ID Manager decide SEM gastar token quando dá)
// ---------------------------------------------------------------------------

export interface RouteDecision {
  slug: CltSlug;
  scores: Partial<Record<CltSlug, number>>;
  /** "keywords" = decidido por regras; "manager" = ambíguo/amplo, o ID Manager coordena (aí sim usa o Claude). */
  by: "keywords" | "manager";
  reason: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function routeTask(prompt: string): RouteDecision {
  const text = norm(prompt);
  const scores: Partial<Record<CltSlug, number>> = {};
  for (const a of CLT_TEAM) {
    if (a.slug === "id-manager") continue;
    let s = 0;
    for (const k of a.keywords) if (text.includes(norm(k))) s += 1;
    if (s > 0) scores[a.slug] = s;
  }
  const ranked = (Object.entries(scores) as Array<[CltSlug, number]>).sort((x, y) => y[1] - x[1]);
  if (ranked.length === 0) return { slug: "id-manager", scores, by: "manager", reason: "Nenhuma especialidade óbvia: o ID Manager decide." };
  const [top, second] = ranked;
  // Outro cargo com pelo menos metade da pontuação do líder: o pedido cruza especialidades, é trabalho de coordenação.
  if (second && second[1] * 2 >= top[1]) return { slug: "id-manager", scores, by: "manager", reason: `Pedido cruza especialidades (${top[0]} e ${second[0]}): o ID Manager coordena.` };
  return { slug: top[0], scores, by: "keywords", reason: `Palavras-chave de ${cltDef(top[0])?.roleTitle ?? top[0]}.` };
}

// ---------------------------------------------------------------------------
// Duplicatas
// ---------------------------------------------------------------------------

/** Texto normalizado para comparar tarefas: minúsculas, sem acento, sem pontuação, espaços únicos. */
export function normalizePrompt(prompt: string): string {
  return norm(prompt).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Há tarefa igual (mesmo texto normalizado) já na fila/executando? */
export function findDuplicate<T extends { prompt: string }>(prompt: string, active: T[]): T | undefined {
  const n = normalizePrompt(prompt);
  if (!n) return undefined;
  return active.find((t) => normalizePrompt(t.prompt) === n);
}

// ---------------------------------------------------------------------------
// Orçamento de tokens
// ---------------------------------------------------------------------------

export interface BudgetInput {
  usedDay: number;
  usedMonth: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  /** % do limite a partir do qual avisa (padrão 80). */
  alertPercent?: number;
}

export interface BudgetState {
  level: "ok" | "warn" | "blocked";
  blocked: boolean;
  dayPercent: number | null;
  monthPercent: number | null;
  reason: string | null;
}

const pct = (used: number, limit: number | null) => (limit && limit > 0 ? Math.round((used / limit) * 100) : null);

export function evaluateBudget(b: BudgetInput): BudgetState {
  const alert = b.alertPercent ?? 80;
  const dayPercent = pct(b.usedDay, b.dailyLimit);
  const monthPercent = pct(b.usedMonth, b.monthlyLimit);
  if (dayPercent !== null && dayPercent >= 100) return { level: "blocked", blocked: true, dayPercent, monthPercent, reason: "Limite diário de tokens esgotado para este agente." };
  if (monthPercent !== null && monthPercent >= 100) return { level: "blocked", blocked: true, dayPercent, monthPercent, reason: "Limite mensal de tokens esgotado para este agente." };
  const warn = (dayPercent !== null && dayPercent >= alert) || (monthPercent !== null && monthPercent >= alert);
  return { level: warn ? "warn" : "ok", blocked: false, dayPercent, monthPercent, reason: warn ? `Consumo de tokens em ${Math.max(dayPercent ?? 0, monthPercent ?? 0)}% do limite.` : null };
}

/** Texto acrescentado ao prompt de sistema do Claude para um agente CLT: cargo, descrição e as regras da equipe. */
export function cltRoleNote(def: Pick<CltAgentDef, "name" | "roleTitle" | "description">): string {
  return ` Você faz parte da equipe AGENTES CLT da ID System como ${def.roleTitle} (${def.name}). ${def.description} Regras da equipe: ${CLT_RULES.join(" ")}`;
}
