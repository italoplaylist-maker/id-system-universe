import { z } from "zod";
import { prisma } from "@/server/db/client";
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Role, User } from "@prisma/client";

export interface SanitizedUser {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date;
}

function sanitize(user: User): SanitizedUser {
  return { id: user.id, email: user.email, role: user.role, active: user.active, createdAt: user.createdAt };
}

export async function listUsers(): Promise<SanitizedUser[]> {
  const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(sanitize);
}

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]),
});

export async function createUser(input: unknown, actor: { userId: string; ip?: string; userAgent?: string }): Promise<SanitizedUser> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");
  if (!isPasswordStrongEnough(parsed.data.password)) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError("A user with this email already exists.");

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({ data: { email, passwordHash, role: parsed.data.role } });

  await recordAuditEvent({
    userId: actor.userId,
    action: "USER_CREATED",
    status: "SUCCESS",
    metadata: { createdUserId: user.id, email: user.email, role: user.role },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return sanitize(user);
}

const updateUserSchema = z.object({
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
});

export async function updateUser(
  id: string,
  input: unknown,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<SanitizedUser> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("User not found.");

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  // An admin manages other accounts here, never their own — self-demotion or
  // self-deactivation through this screen could lock the only admin out.
  if (id === actor.userId && (parsed.data.role !== undefined || parsed.data.active !== undefined)) {
    throw new ForbiddenError("You cannot change your own role or active status here.");
  }

  const data: { role?: Role; active?: boolean; passwordHash?: string } = {};
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (parsed.data.password) {
    if (!isPasswordStrongEnough(parsed.data.password)) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    data.passwordHash = await hashPassword(parsed.data.password);
  }

  const updated = await prisma.user.update({ where: { id }, data });

  if (data.role && data.role !== existing.role) {
    await recordAuditEvent({
      userId: actor.userId,
      action: "USER_ROLE_CHANGED",
      status: "SUCCESS",
      metadata: { targetUserId: id, from: existing.role, to: data.role },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  }
  if (data.active !== undefined && data.active !== existing.active) {
    await recordAuditEvent({
      userId: actor.userId,
      action: data.active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      status: "SUCCESS",
      metadata: { targetUserId: id },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    if (!data.active) {
      // Deactivating revokes access immediately, not just at next login.
      await prisma.session.deleteMany({ where: { userId: id } });
    }
  }
  if (data.passwordHash) {
    await recordAuditEvent({
      userId: actor.userId,
      action: "USER_PASSWORD_RESET",
      status: "SUCCESS",
      metadata: { targetUserId: id },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  return sanitize(updated);
}
