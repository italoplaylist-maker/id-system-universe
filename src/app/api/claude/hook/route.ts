import { HOOK_SCRIPT } from "@/server/claude/hook-script";

/** Público de propósito: o script não contém segredo (URL e token entram por variáveis de ambiente). */
export async function GET() {
  return new Response(HOOK_SCRIPT, { headers: { "Content-Type": "text/x-python; charset=utf-8", "Cache-Control": "no-store" } });
}
