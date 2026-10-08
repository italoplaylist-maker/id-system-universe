import { NextResponse } from "next/server";
import { handleGitHubWebhook } from "@/server/github/webhook";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Público (o GitHub não tem cookie de sessão): a autenticação é a assinatura
 * HMAC do corpo bruto, validada ANTES de qualquer processamento.
 */
export async function POST(request: Request) {
  try {
    // Teto generoso só para conter abuso — entregas legítimas do GitHub são bem menos.
    consumeRateLimit("webhook:github", 600, 60_000);
    const rawBody = await request.text();
    const result = await handleGitHubWebhook(rawBody, {
      signature: request.headers.get("x-hub-signature-256"),
      deliveryId: request.headers.get("x-github-delivery"),
      event: request.headers.get("x-github-event"),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    logger.error("github_webhook_route_failed", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
