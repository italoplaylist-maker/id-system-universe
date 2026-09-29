import { NextResponse } from "next/server";
import { destroyCurrentSession, getSessionUser } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/audit-log";

export async function POST() {
  const user = await getSessionUser();
  await destroyCurrentSession();
  if (user) {
    await recordAuditEvent({ userId: user.id, action: "AUTH_LOGOUT", status: "SUCCESS" });
  }
  return NextResponse.json({ ok: true });
}
