import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { STALE_AFTER_MS } from "@/server/orchestrator/worker";

export const dynamic = "force-dynamic";

/** Diz se o servidor tem como falar com o Claude (sem expor segredo). Só uma dica: a prova real é a primeira execução. */
export async function GET() {
  try {
    await guard(false);
    const apiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const oauth = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
    const login = existsSync(join(homedir(), ".claude", ".credentials.json"));
    const provider = process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX ? "cloud" : null;
    const authenticated = apiKey || oauth || login || Boolean(provider);
    return NextResponse.json({
      authenticated,
      method: apiKey ? "ANTHROPIC_API_KEY" : oauth ? "CLAUDE_CODE_OAUTH_TOKEN" : login ? "login" : provider,
      hint: authenticated ? null : "Defina ANTHROPIC_API_KEY (ou faça `claude login`) no servidor do Universe para que os agentes possam executar.",
      staleAfterMs: STALE_AFTER_MS,
    });
  } catch (error) {
    return apiError(error);
  }
}
