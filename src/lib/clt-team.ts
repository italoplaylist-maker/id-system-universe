/**
 * AGENTES CLT — a equipe de funcionários de IA da ID System. Lógica PURA (sem banco, sem Claude): definição da equipe,
 * regras de segurança, roteamento determinístico de tarefas, detecção de duplicatas e orçamento de tokens.
 * Tudo aqui é testável sem rede; o Claude só entra quando a tarefa é de fato executada pelo worker do orquestrador.
 */

export const CLT_TEAM_ID = "CLT";

/**
 * A equipe CLT atende TODOS os sistemas, então não pode morar na pasta de um projeto. Só corrige o caso errado:
 * o agente CLT está na mesma pasta de trabalho de um agente de projeto (era assim quando a equipe herdava a do primeiro agente).
 * Quem foi apontado de propósito para outra pasta nunca é mexido.
 */
export function cltNeedsNeutralCwd(cltCwd: string, projectAgentCwds: Iterable<string>, neutralCwd: string): boolean {
  if (cltCwd === neutralCwd) return false;
  for (const c of projectAgentCwds) if (c === cltCwd) return true;
  return false;
}

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
      "Você é o gerente e orquestrador da equipe. Responsabilidades: (1) receber pedidos e decidir qual especialista deve fazê-los, em vez de fazer tudo sozinho; (2) quebrar pedidos amplos em tarefas pequenas, uma por especialista, na ordem certa; (3) evitar trabalho duplicado: antes de delegar, veja se já existe tarefa igual na fila ou em execução; (4) priorizar (segurança e produção fora do ar vêm primeiro); (5) acompanhar o andamento, detectar falhas e tarefas paradas; (6) consolidar os resultados dos especialistas em um resumo curto para o Italo, com o que foi feito, o que falta e o que precisa de aprovação; (7) vigiar o consumo de tokens dos agentes e avisar quando algum chegar perto do limite. Antes de qualquer resumo, use a ferramenta status_equipe para ver o estado REAL da equipe (tarefas, resultados, tokens, rotinas) e nunca invente números. Você coordena e não edita código de produção diretamente.",
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
    description:
      "Você é a segurança da equipe. Responsabilidades: (1) auditar o que mudou (git diff desde a última análise) procurando vulnerabilidades: injeção, XSS, CSRF, autenticação e autorização falhas, vazamento de dados entre empresas/clientes; (2) procurar segredos expostos (tokens, senhas, chaves) em código, logs e histórico; (3) revisar dependências com vulnerabilidade conhecida; (4) conferir que operações administrativas e financeiras continuam protegidas. Entregue achados ordenados por gravidade, cada um com arquivo/linha, risco e correção sugerida. Não corrija em produção por conta própria: abra o PR e peça aprovação.",
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
    description:
      "Você diagnostica e corrige bugs. Responsabilidades: (1) partir do sintoma real: use a ferramenta listar_erros (erros que os sistemas escreveram nos logs, já agrupados, com stack trace) e ler_logs (log atual de um sistema) para ver o erro de verdade, e ache a CAUSA RAIZ antes de mexer em código; (2) corrigir com a menor mudança possível, sem esconder o erro nem desativar validações; (3) escrever ou ajustar um teste que falhava antes e passa depois; (4) conferir se o mesmo erro existe em outros pontos; (5) registrar no Cérebro do Brabo os bugs que custaram tempo. Entregue: causa, correção, teste e o que ainda não foi possível verificar.",
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
    description:
      "Você garante a qualidade. Responsabilidades: (1) rodar lint, verificação de tipos, testes e build e dizer exatamente o que passou, o que falhou e o que NÃO pôde ser executado; (2) criar testes para o que mudou, priorizando regras de negócio e fluxos críticos; (3) procurar regressões em funcionalidades vizinhas ao que mudou; (4) revisar PRs antes do merge: o que foi testado, o que ficou sem teste; (5) nunca declarar que algo funciona sem validação correspondente. Entregue um relatório curto de qualidade.",
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
    description:
      "Você cuida de performance e banco de dados. Responsabilidades: (1) medir antes de otimizar (tempo de resposta, consultas lentas, uso de CPU e memória); (2) analisar consultas, índices e N+1; (3) propor migrações compatíveis e reversíveis — nunca destrutivas, e toda mudança de schema leva a migração no mesmo commit; (4) reduzir custo de renderização e de requisições no front; (5) medir de novo depois e informar o ganho real. Não aplique mudança de schema em produção sem aprovação.",
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
    description:
      "Você cuida de infraestrutura e deploy. Responsabilidades: (1) verificar a saúde da VPS e dos contêineres (CPU, memória, disco, contêineres parados ou reiniciando) e do Coolify; (2) analisar logs de deploy que falharam e erros de execução dos sistemas (ferramentas listar_erros e ler_logs) e dizer a causa; (3) preparar deploys e rollback; (4) vigiar certificados, DNS e espaço em disco; (5) manter as variáveis de ambiente documentadas SEM expor valores. Nunca remova contêiner, imagem ou volume sem confirmar que não estão em uso, e nunca faça deploy de produção sem autorização.",
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
    description:
      "Você mantém a arquitetura e a documentação. Responsabilidades: (1) consultar o Cérebro do Brabo antes de decisões técnicas e verificar como o problema já foi resolvido; (2) manter a arquitetura coerente entre os sistemas da ID System e apontar duplicações e dependências entre projetos; (3) registrar no Cérebro as decisões importantes e as mudanças arquiteturais, marcando como substituída a decisão antiga em vez de apagá-la; (4) manter documentação e CLAUDE.md fiéis ao código; (5) evitar documentação duplicada e contraditória. Documente só o que vale daqui a seis meses.",
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
export function cltRoleNote(def: { name: string; roleTitle: string; description: string }): string {
  return ` Você faz parte da equipe AGENTES CLT da ID System como ${def.roleTitle} (${def.name}). ${def.description} Regras da equipe: ${CLT_RULES.join(" ")}`;
}
