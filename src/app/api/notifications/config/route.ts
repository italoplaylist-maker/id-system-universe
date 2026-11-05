import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { requireSessionUser } from "@/server/auth/session";
import { getVapidKeys } from "@/server/notifications/vapid";

export const dynamic = "force-dynamic";

/** Chave pública VAPID: o navegador precisa dela para assinar o push. */
export async function GET() {
  try {
    await requireSessionUser();
    return NextResponse.json({ publicKey: (await getVapidKeys()).publicKey });
  } catch (error) {
    return apiError(error);
  }
}
