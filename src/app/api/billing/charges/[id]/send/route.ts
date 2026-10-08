import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { previewChargeMessage, sendChargeNow } from "@/server/billing/charge-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Params = Promise<{ id: string }>;

const bodySchema = z.object({ confirm: z.boolean().default(false), message: z.string().max(1500).optional() });

/** Sem `confirm`: devolve só o preview. Com `confirm: true`: envia e registra no histórico. */
export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const user = await authorize("billing:manage");
    const { id } = await params;
    const { confirm, message } = bodySchema.parse(await readJson(request));
    if (!confirm) return NextResponse.json({ preview: await previewChargeMessage(id, user) });
    consumeRateLimit(`billing-send:${user.id}`, 20, 60_000);
    return NextResponse.json({ result: await sendChargeNow(id, { message }, user, await actorFor(user)) });
  } catch (error) {
    return apiError(error);
  }
}
