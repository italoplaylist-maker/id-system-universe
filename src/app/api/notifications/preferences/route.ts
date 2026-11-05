import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/lib/errors";
import { apiError, readJson } from "@/server/http/api-helpers";
import { requireSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const KEYS = ["deploys", "agents", "approvals", "servers", "billing"] as const;

async function read(userId: string) {
  const p = await prisma.notificationPreference.findUnique({ where: { userId } });
  const devices = await prisma.pushSubscription.count({ where: { userId } });
  return { prefs: Object.fromEntries(KEYS.map((k) => [k, p ? p[k] : true])) as Record<(typeof KEYS)[number], boolean>, devices };
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
    const parsed = z.object({ deploys: z.boolean(), agents: z.boolean(), approvals: z.boolean(), servers: z.boolean(), billing: z.boolean() }).partial().safeParse(await readJson(request));
    if (!parsed.success) throw new ValidationError("Preferências inválidas.");
    await prisma.notificationPreference.upsert({ where: { userId: user.id }, create: { userId: user.id, ...parsed.data }, update: parsed.data });
    return NextResponse.json(await read(user.id));
  } catch (error) {
    return apiError(error);
  }
}
