import { NextResponse } from "next/server";
import { apiError, readJson } from "@/server/http/api-helpers";
import { requireSessionUser } from "@/server/auth/session";
import { sendTestNotification } from "@/server/notifications/notify";
import { consumeRateLimit } from "@/server/security/rate-limit";

/** Teste de ponta a ponta só para quem pediu. Responde o que de fato aconteceu em cada aparelho / no WhatsApp. */
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    consumeRateLimit(`push-test:${user.id}`, 8, 60_000);
    const body = (await readJson(request)) as { channel?: string };
    const channel = body.channel === "whatsapp" ? "whatsapp" : body.channel === "push" ? "push" : "all";
    return NextResponse.json(await sendTestNotification(user.id, channel));
  } catch (error) {
    return apiError(error);
  }
}
