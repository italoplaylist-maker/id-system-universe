import { NextResponse } from "next/server";
import { bootstrapAdmin, isBootstrapAvailable } from "@/server/auth/bootstrap";
import { createSession, getRequestMeta } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { apiError } from "@/server/http/api-helpers";

export async function GET() {
  const available = await isBootstrapAvailable();
  return NextResponse.json({ available });
}

export async function POST(request: Request) {
  try {
    consumeRateLimit("bootstrap", 5, 60_000);
    const body = await request.json();
    const user = await bootstrapAdmin(body);
    const meta = await getRequestMeta();
    await createSession(user.id, meta);
    await recordAuditEvent({ userId: user.id, action: "AUTH_BOOTSTRAP", status: "SUCCESS", ipAddress: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ user });
  } catch (error) {
    return apiError(error);
  }
}
