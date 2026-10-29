import { NextResponse } from "next/server";

/**
 * Origem pública do painel (`APP_URL`, ex.: https://universe.seudominio.com).
 *
 * O servidor standalone escuta em HOSTNAME=0.0.0.0, e é esse host que `request.url`
 * enxerga atrás do proxy — por isso redirects montados com `new URL(path, request.url)`
 * mandavam o navegador para https://0.0.0.0:3000/... (ERR_ADDRESS_INVALID).
 * Nunca derivamos a origem do host da requisição (o header Host é controlável pelo cliente).
 */
export function getAppOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Só caminhos internos: "/x" — nunca "//evil.com", "/\evil.com" ou URLs absolutas (open redirect). */
export function isSafeInternalPath(path: string): boolean {
  return /^\/(?![/\\])/.test(path) && !/[\r\n]/.test(path);
}

/**
 * Redirect para um caminho interno. Com APP_URL, usa a origem pública absoluta; sem ela, envia
 * `Location` relativo — o navegador resolve contra o endereço que ele mesmo usou para chegar
 * aqui, que é sempre o correto (dev em http://localhost:3000, produção no domínio HTTPS).
 */
export function redirectToPath(path: string, status: 302 | 307 | 303 = 307, env: Record<string, string | undefined> = process.env): NextResponse {
  if (!isSafeInternalPath(path)) throw new Error("Redirect externo bloqueado.");
  const origin = getAppOrigin(env);
  return new NextResponse(null, { status, headers: { Location: origin ? `${origin}${path}` : path } });
}
