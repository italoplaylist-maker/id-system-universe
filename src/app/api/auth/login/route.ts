import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { createSession, getRequestMeta } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { apiError } from "@/server/http/api-helpers";
import { ValidationError } from "@/lib/errors";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const meta = await getRequestMeta();
    consumeRateLimit(`login:${meta.ip ?? "unknown"}`, 10, 60_000);

    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError("Email and password are required.");

    const email = parsed.data.email.toLowerCase();
    consumeRateLimit(`login-email:${email}`, 10, 60_000);

    const user = await prisma.user.findUnique({ where: { email } });
    // Run the hash comparison even for a deactivated account so response
    // timing doesn't reveal whether the account exists vs. is disabled.
    const passwordOk = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
    const valid = passwordOk && Boolean(user?.active);

    if (!user || !valid) {
      await recordAuditEvent({ action: "AUTH_LOGIN_FAILED", status: "FAILED", metadata: { email }, ipAddress: meta.ip, userAgent: meta.userAgent });
      // Deliberately generic — never reveal whether the email exists.
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await createSession(user.id, meta);
    await recordAuditEvent({ userId: user.id, action: "AUTH_LOGIN", status: "SUCCESS", ipAddress: meta.ip, userAgent: meta.userAgent });

    return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    return apiError(error);
  }
}
