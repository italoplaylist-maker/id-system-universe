import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { requireSessionUser } from "@/server/auth/session";
import { notify } from "@/server/notifications/notify";
import { consumeRateLimit } from "@/server/security/rate-limit";

/** Aviso de teste só para quem pediu (pop-up nas suas abas + push nos seus aparelhos). */
export async function POST() {
  try {
    const user = await requireSessionUser();
    consumeRateLimit(`push-test:${user.id}`, 6, 60_000);
    await notify({ kind: "test", level: "success", title: "Notificações funcionando", body: "Você vai receber avisos de deploys, agentes e servidores aqui.", url: "/", tag: "test", audience: { userId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
