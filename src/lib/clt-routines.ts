/**
 * Rotinas agendadas da equipe AGENTES CLT — lógica PURA (horários, janelas, rotinas padrão). O servidor
 * (src/server/orchestrator/routines.ts) executa; aqui só se decide QUANDO uma rotina é devida e o que ela diz.
 * Fuso fixo: America/Sao_Paulo (a empresa opera nele, não importa onde o servidor esteja).
 */
import type { CltSlug } from "./clt-team";

export const ROUTINE_TZ = "America/Sao_Paulo";

/** Gatilhos determinísticos: o Claude só é chamado quando o gatilho confirma que há o que fazer. */
export type RoutineGate = "always" | "changed" | "alert" | "activity";
export const ROUTINE_GATES: Array<{ id: RoutineGate; label: string; help: string }> = [
  { id: "always", label: "Sempre", help: "Roda em todo horário agendado." },
  { id: "changed", label: "Só se houve deploy novo", help: "Pula se não houve deploy com sucesso desde a última execução." },
  { id: "alert", label: "Só se há alerta", help: "Pula se não há aplicação com erro, deploy falho nas últimas 24 h nem servidor em alerta." },
  { id: "activity", label: "Só se a equipe trabalhou", help: "Pula se nenhuma tarefa terminou nas últimas 24 h." },
];

/** -1 baixa · 0 normal · 1 alta: define a ordem na fila quando vários agentes esperam. */
export const ROUTINE_PRIORITIES = [
  { value: 1, label: "Alta" },
  { value: 0, label: "Normal" },
  { value: -1, label: "Baixa" },
] as const;

/** Quanto tempo depois do horário a rotina ainda pode ser disparada (servidor que estava fora do ar na hora). */
export const CATCH_UP_MINUTES = 90;

export const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export interface LocalParts {
  /** AAAA-MM-DD no fuso da empresa. */
  date: string;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Minutos desde 00:00 no fuso da empresa. */
  minutes: number;
}

export function localParts(now: Date): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ROUTINE_TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const isValidTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * O horário de hoje desta rotina, se ela é devida AGORA: dia da semana marcado e entre o horário e o horário + janela.
 * Devolve a chave do horário ("AAAA-MM-DD HH:MM"), usada para nunca disparar duas vezes o mesmo horário.
 */
export function dueSlot(routine: { days: number[]; time: string }, now: Date, catchUpMinutes: number = CATCH_UP_MINUTES): string | null {
  if (!isValidTime(routine.time)) return null;
  const p = localParts(now);
  if (!routine.days.includes(p.weekday)) return null;
  const elapsed = p.minutes - toMinutes(routine.time);
  if (elapsed < 0 || elapsed >= catchUpMinutes) return null;
  return `${p.date} ${routine.time}`;
}

/** "Seg a Sex às 03:00", "Todos os dias às 07:00", "Dom às 03:00". */
export function describeSchedule(routine: { days: number[]; time: string }): string {
  const days = [...new Set(routine.days)].sort((a, b) => a - b);
  let label: string;
  if (days.length === 7) label = "Todos os dias";
  else if (days.length === 5 && days.join() === "1,2,3,4,5") label = "Seg a Sex";
  else if (days.length === 0) label = "Nenhum dia";
  else label = days.map((d) => DAY_LABELS[d]).join(", ");
  return `${label} às ${routine.time}`;
}

// ---------------------------------------------------------------------------
// Rotinas padrão (o que cada funcionário faz sozinho, e quando)
// ---------------------------------------------------------------------------

export interface CltRoutineDef {
  slug: CltSlug;
  name: string;
  prompt: string;
  days: number[];
  time: string;
  priority: number;
  gate: RoutineGate;
}

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

const ECONOMIA = " Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.";

export const CLT_ROUTINES: CltRoutineDef[] = [
  {
    slug: "id-devops",
    name: "Verificação de infraestrutura",
    days: ALL,
    time: "07:00",
    priority: 1,
    gate: "alert",
    prompt:
      "Rotina diária de infraestrutura. O Universe detectou algo anormal (aplicação com erro, deploy falho nas últimas 24 h ou servidor em alerta). Diagnostique: estado dos servidores e contêineres, disco, memória, deploys que falharam e erros nos logs (use listar_erros e ler_logs), com a causa provável de cada um. Entregue a ação recomendada para cada problema. NÃO reinicie, remova nem faça deploy: peça aprovação." +
      ECONOMIA,
  },
  {
    slug: "id-doctor",
    name: "Diagnóstico de erros",
    days: ALL,
    time: "07:30",
    priority: 1,
    gate: "alert",
    prompt:
      "Rotina diária de diagnóstico. Há aplicação em erro ou deploy falho recente. Para cada caso, parta do log real (use listar_erros para ver os erros agrupados e ler_logs para o contexto), ache a causa raiz e, se for erro de código, prepare a correção mínima com teste em um PR (sem fazer merge). Se a causa for de infraestrutura, apenas descreva-a para o ID DevOps." + ECONOMIA,
  },
  {
    slug: "id-guardian",
    name: "Auditoria de segurança incremental",
    days: WEEKDAYS,
    time: "03:00",
    priority: 0,
    gate: "changed",
    prompt:
      "Auditoria de segurança incremental. Houve deploy novo desde a última auditoria. Analise SOMENTE o que mudou (git diff desde o último commit analisado no seu histórico): injeção, XSS, CSRF, autenticação e autorização, vazamento de dados entre empresas, segredos expostos. Entregue achados por gravidade com arquivo/linha e correção sugerida; registre qual commit foi o último analisado." +
      ECONOMIA,
  },
  {
    slug: "id-guardian",
    name: "Revisão de dependências",
    days: [1],
    time: "03:30",
    priority: -1,
    gate: "changed",
    prompt: "Revisão semanal de dependências. Verifique dependências com vulnerabilidade conhecida (ex.: npm audit) e pacotes críticos muito desatualizados. Liste só o que exige ação, com gravidade e a atualização segura sugerida. Não atualize nada sem aprovação." + ECONOMIA,
  },
  {
    slug: "id-qa",
    name: "Testes automatizados",
    days: WEEKDAYS,
    time: "04:00",
    priority: 0,
    gate: "changed",
    prompt:
      "Rodada de qualidade. Houve deploy novo. Rode lint, verificação de tipos, testes e build do que mudou e relate exatamente o que passou, o que falhou e o que NÃO foi possível executar. Para falhas, aponte o arquivo e a causa provável; para o que mudou sem teste, proponha os testes mais importantes." +
      ECONOMIA,
  },
  {
    slug: "id-optimizer",
    name: "Revisão de desempenho e banco de dados",
    days: [0],
    time: "03:00",
    priority: -1,
    gate: "always",
    prompt:
      "Revisão semanal de desempenho. Olhe consultas lentas, índices que faltam, crescimento de tabelas, uso de CPU/memória do servidor e tempo de resposta. Meça, não suponha. Liste no máximo 5 melhorias ordenadas por ganho esperado, cada uma com a medição que a justifica. Migrações só compatíveis e reversíveis, e sem aplicar nada em produção." +
      ECONOMIA,
  },
  {
    slug: "id-architect",
    name: "Atualização da documentação",
    days: WEEKDAYS,
    time: "18:00",
    priority: -1,
    gate: "changed",
    prompt:
      "Manutenção da documentação. Houve deploy novo. Confira se o Cérebro do Brabo e o CLAUDE.md do projeto refletem o que mudou (decisões, arquitetura, regras). Atualize SÓ o necessário, marcando como substituída a decisão antiga em vez de apagá-la, e evite documentação duplicada." +
      ECONOMIA,
  },
  {
    slug: "id-manager",
    name: "Resumo diário da equipe",
    days: ALL,
    time: "08:30",
    priority: 0,
    gate: "activity",
    prompt:
      "Resumo diário. Use a ferramenta status_equipe e consolide em até 15 linhas o que a equipe fez nas últimas 24 h: tarefas concluídas, falhas, aprovações pendentes e o consumo de tokens de cada agente frente ao limite. Destaque o que precisa de decisão do Italo. Não crie nem delegue tarefas novas neste resumo." +
      ECONOMIA,
  },
];
