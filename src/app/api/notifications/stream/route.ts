import { apiError } from "@/server/http/api-helpers";
import { requireSessionUser } from "@/server/auth/session";
import { getProjectScope } from "@/server/auth/project-access";
import { prisma } from "@/server/db/client";
import { notificationBus } from "@/server/notifications/bus";
import { audienceAllows, type Recipient } from "@/server/notifications/audience";
import { prefsToEnabled } from "@/server/notifications/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pop-ups em tempo real para as abas abertas: cada conexão só recebe o que o usuário pode ver e quer ver. */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (error) {
    return apiError(error);
  }
  const scope = await getProjectScope(user);
  const prefsRow = await prisma.notificationPreference.findUnique({ where: { userId: user.id } });
  const recipient: Recipient = { user, scope, enabled: prefsToEnabled(prefsRow) };
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send("retry: 3000\n: connected\n\n");
      // preferências mudam sem reconectar: relê de vez em quando
      const refresh = setInterval(() => {
        prisma.notificationPreference.findUnique({ where: { userId: recipient.user.id } }).then((p) => {
          recipient.enabled = prefsToEnabled(p);
        }).catch(() => undefined);
      }, 30_000);
      const unsubscribe = notificationBus.subscribe((m) => {
        if (audienceAllows(recipient, m.kind, m.audience)) send(`event: notify\ndata: ${JSON.stringify(m.payload)}\n\n`);
      });
      const keepalive = setInterval(() => send(": ping\n\n"), 20_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearInterval(refresh);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // já fechado
        }
      };
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
