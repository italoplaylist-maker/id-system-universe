import { AGENT_SCRIPT } from "@/server/monitoring/agent-script";

/** Público de propósito: o script não contém segredo (URL e token entram por variáveis de ambiente). */
export async function GET() {
  return new Response(AGENT_SCRIPT, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" } });
}
