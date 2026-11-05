import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { orchestratorBus } from "@/server/orchestrator/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE: só avisa "algo mudou" (tipo + ids). O cliente rebusca o estado real — nunca confia no evento como dado. */
export async function GET(request: Request) {
  try {
    await guard(false);
  } catch (error) {
    return apiError(error);
  }
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
      const unsubscribe = orchestratorBus.subscribe((event) => send(`event: change\ndata: ${JSON.stringify(event)}\n\n`));
      const keepalive = setInterval(() => send(": ping\n\n"), 20_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
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
