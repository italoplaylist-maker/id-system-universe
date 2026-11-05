import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/lib/errors";
import { normalizePhone, formatPhoneBR } from "@/lib/phone";
import { apiError, readJson } from "@/server/http/api-helpers";
import { requireSessionUser } from "@/server/auth/session";
import { deviceLabel } from "@/server/notifications/notify";
import { getWhatsAppConfigSummary } from "@/server/whatsapp/whatsapp-provider";

export const dynamic = "force-dynamic";

const KEYS = ["deploys", "agents", "approvals", "servers", "billing"] as const;

async function read(userId: string) {
  const [p, subs, wa] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    getWhatsAppConfigSummary().catch(() => null),
  ]);
  return {
    prefs: Object.fromEntries(KEYS.map((k) => [k, p ? p[k] : true])) as Record<(typeof KEYS)[number], boolean>,
    devices: subs.map((s) => ({ id: s.id, label: deviceLabel(s.userAgent), lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null, lastError: s.lastError })),
    whatsapp: { enabled: p?.whatsappEnabled ?? false, number: p?.whatsappNumber ? formatPhoneBR(p.whatsappNumber) || p.whatsappNumber : "", serviceConfigured: Boolean(wa?.configured) },
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    return NextResponse.json(await read(user.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser();
    const parsed = z
      .object({ deploys: z.boolean(), agents: z.boolean(), approvals: z.boolean(), servers: z.boolean(), billing: z.boolean(), whatsappEnabled: z.boolean(), whatsappNumber: z.string().max(40).nullable() })
      .partial()
      .safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Preferências inválidas.");
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.whatsappNumber !== undefined) {
      if (parsed.data.whatsappNumber === null || parsed.data.whatsappNumber.trim() === "") data.whatsappNumber = null;
      else {
        const n = normalizePhone(parsed.data.whatsappNumber);
        if (!n) throw new ValidationError("Número de WhatsApp inválido. Use DDD + número, ex.: (11) 91234-5678.");
        data.whatsappNumber = n;
      }
    }
    if (data.whatsappEnabled === true) {
      const existing = await prisma.notificationPreference.findUnique({ where: { userId: user.id } });
      if (!data.whatsappNumber && !existing?.whatsappNumber) throw new ValidationError("Informe o número de WhatsApp antes de ligar.");
    }
    await prisma.notificationPreference.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    return NextResponse.json(await read(user.id));
  } catch (error) {
    return apiError(error);
  }
}
