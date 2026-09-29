import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/server/db/client";
import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "isu_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
  }
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  request?: { ip?: string; userAgent?: string },
): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ipAddress: request?.ip,
      userAgent: request?.userAgent,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => undefined);
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Returns the current user, or null if there is no valid session. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    }
    return null;
  }

  return { id: session.user.id, email: session.user.email, role: session.user.role };
}

/** Throws UnauthorizedError instead of returning null — for route handlers. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function getRequestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  return {
    ip: forwardedFor?.split(",")[0]?.trim() ?? undefined,
    userAgent: headerList.get("user-agent") ?? undefined,
  };
}
