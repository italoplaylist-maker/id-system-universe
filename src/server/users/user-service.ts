import { z } from "zod";
import { prisma } from "@/server/db/client";
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { EXTRA_PERMISSIONS } from "@/server/auth/rbac";
import { setUserProjectAccess } from "@/server/auth/project-access";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Role, User } from "@prisma/client";

export interface SanitizedUser {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  extraPermissions: string[];
  /** Projects que o usuário pode ver (ignorado para SUPERADMIN/ADMIN, que têm acesso global). */
  projectIds: string[];
}

type UserWithAccess = User & { projectAccess: { projectId: string }[] };

function sanitize(user: UserWithAccess): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    extraPermissions: user.extraPermissions,
    projectIds: user.projectAccess.map((a) => a.projectId),
  };
}

const WITH_ACCESS = { projectAccess: { select: { projectId: true } } } as const;

export async function listUsers(): Promise<SanitizedUser[]> {
  const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: WITH_ACCESS });
  return rows.map(sanitize);
}

type Actor = { userId: string; role: Role; ip?: string; userAgent?: string };

const roleSchema = z.enum(["SUPERADMIN", "ADMIN", "OPERATOR", "VIEWER"]);
const extraPermissionsSchema = z.array(z.enum(EXTRA_PERMISSIONS)).max(EXTRA_PERMISSIONS.length);
const projectIdsSchema = z.array(z.string().min(1)).max(500);

/** Só SUPERADMIN cria/edita SUPERADMIN e concede permissões financeiras. */
function assertCanGrant(actor: Actor, target: { role?: Role; existingRole?: Role; extraPermissions?: string[] }): void {
  if (actor.role === "SUPERADMIN") return;
  if (target.role === "SUPERADMIN" || target.existingRole === "SUPERADMIN") {
    throw new ForbiddenError("Somente um Superadmin pode gerenciar Superadmins.");
  }
  if (target.extraPermissions && target.extraPermissions.length > 0) {
    throw new ForbiddenError("Somente um Superadmin pode conceder permissões financeiras.");
  }
}

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: roleSchema,
  extraPermissions: extraPermissionsSchema.optional(),
  projectIds: projectIdsSchema.optional(),
});

export async function createUser(input: unknown, actor: Actor): Promise<SanitizedUser> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");
  if (!isPasswordStrongEnough(parsed.data.password)) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  assertCanGrant(actor, { role: parsed.data.role, extraPermissions: parsed.data.extraPermissions });

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError("A user with this email already exists.");

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: parsed.data.role, extraPermissions: parsed.data.extraPermissions ?? [] },
    include: WITH_ACCESS,
  });
  if (parsed.data.projectIds) await setUserProjectAccess(user.id, parsed.data.projectIds);

  await recordAuditEvent({
    userId: actor.userId,
    action: "USER_CREATED",
    status: "SUCCESS",
    metadata: { createdUserId: user.id, email: user.email, role: user.role, projectIds: parsed.data.projectIds ?? [] },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  const created = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: WITH_ACCESS });
  return sanitize(created);
}

const updateUserSchema = z.object({
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  extraPermissions: extraPermissionsSchema.optional(),
  projectIds: projectIdsSchema.optional(),
});

export async function updateUser(id: string, input: unknown, actor: Actor): Promise<SanitizedUser> {
  const existing = await prisma.user.findUnique({ where: { id }, include: WITH_ACCESS });
  if (!existing) throw new NotFoundError("User not found.");

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  assertCanGrant(actor, { role: parsed.data.role, existingRole: existing.role, extraPermissions: parsed.data.extraPermissions });

  // An admin manages other accounts here, never their own — self-demotion or
  // self-deactivation through this screen could lock the only admin out.
  if (id === actor.userId && (parsed.data.role !== undefined || parsed.data.active !== undefined || parsed.data.extraPermissions !== undefined || parsed.data.projectIds !== undefined)) {
    throw new ForbiddenError("You cannot change your own role or active status here.");
  }

  const data: { role?: Role; active?: boolean; passwordHash?: string; extraPermissions?: string[] } = {};
  if (parsed.data.extraPermissions) data.extraPermissions = parsed.data.extraPermissions;
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (parsed.data.password) {
    if (!isPasswordStrongEnough(parsed.data.password)) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    data.passwordHash = await hashPassword(parsed.data.password);
  }

  await prisma.user.update({ where: { id }, data });
  if (parsed.data.projectIds) {
    await setUserProjectAccess(id, parsed.data.projectIds);
    await recordAuditEvent({
      userId: actor.userId,
      action: "USER_PROJECT_ACCESS_CHANGED",
      status: "SUCCESS",
      metadata: { targetUserId: id, projectIds: parsed.data.projectIds },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  }
  if (data.extraPermissions) {
    await recordAuditEvent({
      userId: actor.userId,
      action: "USER_PERMISSIONS_CHANGED",
      status: "SUCCESS",
      metadata: { targetUserId: id, extraPermissions: data.extraPermissions },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  }
  const updated = await prisma.user.findUniqueOrThrow({ where: { id }, include: WITH_ACCESS });

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
