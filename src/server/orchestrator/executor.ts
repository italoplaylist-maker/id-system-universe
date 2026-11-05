import type { CanUseTool, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** O que o worker precisa de um executor — o real usa o Claude Agent SDK; os testes injetam um falso. */
export interface ExecutorRunInput {
  taskId: string;
  prompt: string;
  cwd: string;
  model?: string | null;
  permissionMode: "default" | "acceptEdits" | "plan";
  agentName: string;
  specialty?: string | null;
  effort?: string | null;
  /** Ferramentas liberadas sem pedir aprovação / bloqueadas (regras do Claude Code, ex.: "Bash(git status:*)"). */
  allowedTools?: string[];
  disallowedTools?: string[];
  /** Servidores MCP cadastrados no Universe (já com segredos decifrados, só em memória). */
  mcpServers?: Record<string, unknown>;
  /** Sessão anterior do agente: o contexto continua. */
  resumeSessionId?: string | null;
  signal: AbortSignal;
  canUseTool: (tool: string, input: Record<string, unknown>) => Promise<{ allow: boolean; message?: string }>;
  onStarted: (info: { sessionId?: string; model?: string }) => Promise<void> | void;
  onText: (text: string) => Promise<void> | void;
  onToolUse: (tool: string, summary: string) => Promise<void> | void;
  onToolResult: (summary: string, isError: boolean) => Promise<void> | void;
}

export interface ExecutorResult {
  sessionId?: string;
  result?: string;
  costUsd?: number;
  turns?: number;
}

export interface TaskExecutor {
  run(input: ExecutorRunInput): Promise<ExecutorResult>;
}

/** Falha antes de qualquer execução (ex.: sessão para retomar não existe mais). */
export class ExecutorStartError extends Error {}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "description"]) {
    if (typeof o[key] === "string") return (o[key] as string).replace(/\s+/g, " ").slice(0, 300);
  }
  return "";
}

/**
 * Execução REAL: Claude Agent SDK (o mesmo motor do Claude Code), no diretório do agente, retomando a
 * sessão persistente. A mensagem é submetida pelo `query()` — não há campo de texto nem ENTER.
 * Credenciais: ANTHROPIC_API_KEY (ou login do Claude Code) no ambiente do servidor do Universe.
 */
export class ClaudeSdkExecutor implements TaskExecutor {
  async run(input: ExecutorRunInput): Promise<ExecutorResult> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    if (input.signal.aborted) abortController.abort();
    input.signal.addEventListener("abort", onAbort, { once: true });

    const canUseTool: CanUseTool = async (tool, toolInput) => {
      const decision = await input.canUseTool(tool, toolInput);
      return decision.allow
        ? { behavior: "allow", updatedInput: toolInput }
        : { behavior: "deny", message: decision.message ?? "Negado no ID System Universe." };
    };

    const append = `Você é o agente "${input.agentName}" do ID System Universe${input.specialty ? ` (especialidade: ${input.specialty})` : ""}. Responda em português.`;
    const options: Options = {
      cwd: input.cwd,
      abortController,
      permissionMode: input.permissionMode,
      canUseTool,
      // "user" = ~/.claude do servidor (skills, CLAUDE.md global, plugins instalados); "project" = o que está no repositório.
      settingSources: ["user", "project"],
      skills: "all",
      systemPrompt: { type: "preset", preset: "claude_code", append },
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort && ["low", "medium", "high", "xhigh", "max"].includes(input.effort) ? { effort: input.effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
      ...(input.allowedTools?.length ? { allowedTools: input.allowedTools } : {}),
      ...(input.disallowedTools?.length ? { disallowedTools: input.disallowedTools } : {}),
      ...(input.mcpServers && Object.keys(input.mcpServers).length ? { mcpServers: input.mcpServers as Options["mcpServers"] } : {}),
      ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
    };

    let started = false;
    let sessionId: string | undefined;
    let result: ExecutorResult = {};
    try {
      const stream = query({ prompt: input.prompt, options });
      for await (const message of stream as AsyncIterable<SDKMessage>) {
        const m = message as SDKMessage & { session_id?: string };
        if (m.session_id) sessionId = m.session_id;
        if (m.type === "system" && "subtype" in m && m.subtype === "init") {
          started = true;
          await input.onStarted({ sessionId, model: (m as { model?: string }).model });
          continue;
        }
        if (!started && m.type === "assistant") {
          started = true;
          await input.onStarted({ sessionId });
        }
        if (m.type === "assistant") {
          const content = (m as unknown as { message: { content: Array<Record<string, unknown>> } }).message.content ?? [];
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string" && block.text.trim()) await input.onText(block.text);
            else if (block.type === "tool_use") await input.onToolUse(String(block.name), summarizeInput(block.input));
          }
        } else if (m.type === "user") {
          const content = (m as unknown as { message: { content: unknown } }).message.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block.type === "tool_result") {
                const raw = block.content;
                const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((c) => (typeof (c as { text?: string }).text === "string" ? (c as { text: string }).text : "")).join(" ") : "";
                await input.onToolResult(text.replace(/\s+/g, " ").slice(0, 300), block.is_error === true);
              }
            }
          }
        } else if (m.type === "result") {
          const r = m as unknown as { subtype: string; is_error?: boolean; result?: string; total_cost_usd?: number; num_turns?: number; errors?: string[] };
          result = { sessionId, result: r.result, costUsd: r.total_cost_usd, turns: r.num_turns };
          if (r.subtype !== "success" || r.is_error) {
            throw new Error(r.errors?.join("; ") || r.result || `Execução terminou com erro (${r.subtype}).`);
          }
        }
      }
    } catch (error) {
      if (!started && input.resumeSessionId) throw new ExecutorStartError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
    return { ...result, sessionId: result.sessionId ?? sessionId };
  }
}

const g = globalThis as unknown as { __isuExecutor?: TaskExecutor };

export function getExecutor(): TaskExecutor {
  return (g.__isuExecutor ??= new ClaudeSdkExecutor());
}

/** Só para testes: troca o executor (o real exige Claude autenticado). */
export function setExecutor(executor: TaskExecutor | null) {
  g.__isuExecutor = executor ?? new ClaudeSdkExecutor();
}
