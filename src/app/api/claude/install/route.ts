import { INSTALL_SCRIPT } from "@/server/claude/install-script";

/** Público de propósito: o script não contém segredo — o token entra por variável de ambiente do ambiente de nuvem. */
export async function GET() {
  return new Response(INSTALL_SCRIPT, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" } });
}
