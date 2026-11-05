import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/lib/errors";
import { apiError, readJson } from "@/server/http/api-helpers";
import { getRequestMeta, requireSessionUser } from "@/server/auth/session";
import { consumeRateLimit } from "@/server/security/rate-limit";

const schema = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Endpoint inválido."),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(10).max(100) }),
});

/** Registra (ou move para este usuário) o aparelho que aceitou receber push. */
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    consumeRateLimit(`push-subscribe:${user.id}`, 30, 60_000);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Assinatura de notificação inválida.");
    const meta = await getRequestMeta();
    const { endpoint, keys } = parsed.data;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: meta.userAgent?.slice(0, 300) },
      update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, failures: 0, userAgent: meta.userAgent?.slice(0, 300) },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = (await readJson(request)) as { endpoint?: unknown };
    if (typeof body.endpoint !== "string") throw new ValidationError("Informe o endpoint.");
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
