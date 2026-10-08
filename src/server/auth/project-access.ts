import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { hasGlobalProjectScope } from "@/server/auth/rbac";
import type { SessionUser } from "@/server/auth/session";

/**
 * Quais Projects o usuário enxerga. `all` = SUPERADMIN/ADMIN (inclui recursos
 * ainda sem Project). Os demais só enxergam o que consta em ProjectAccess.
 * É a ÚNICA fonte da verdade — toda rota/serviço que devolve dados de um
 * Project passa por aqui; esconder no frontend nunca é suficiente.
 */
export type ProjectScope = { all: true } | { all: false; projectIds: string[] };

export async function getProjectScope(user: Pick<SessionUser, "id" | "role">): Promise<ProjectScope> {
  if (hasGlobalProjectScope(user.role)) return { all: true };
  const rows = await prisma.projectAccess.findMany({
    where: { userId: user.id, project: { archivedAt: null } },
    select: { projectId: true },
  });
  return { all: false, projectIds: rows.map((row) => row.projectId) };
}

export function scopeAllowsProject(scope: ProjectScope, projectId: string | null | undefined): boolean {
  if (scope.all) return true;
  // Recurso sem Project: só quem tem escopo global.
  if (!projectId) return false;
  return scope.projectIds.includes(projectId);
}

export function projectWhere(scope: ProjectScope): Prisma.ProjectWhereInput {
  return scope.all ? {} : { id: { in: scope.projectIds } };
}

export function applicationWhere(scope: ProjectScope): Prisma.ApplicationWhereInput {
  return scope.all ? {} : { projectId: { in: scope.projectIds } };
}

/** 403 quando o usuário não tem acesso ao Project (ou 404 se ele não existe e o usuário é global). */
export async function assertProjectAccess(user: SessionUser, projectId: string): Promise<void> {
  const scope = await getProjectScope(user);
  if (scope.all) {
    const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) throw new NotFoundError("Project not found.");
    return;
  }
  if (!scope.projectIds.includes(projectId)) throw new ForbiddenError("Você não tem acesso a este projeto.");
}

export async function assertApplicationAccess(user: SessionUser, applicationId: string): Promise<{ projectId: string | null }> {
  const row = await prisma.application.findUnique({ where: { id: applicationId }, select: { projectId: true } });
  const scope = await getProjectScope(user);
  if (!row) {
    // Não revela existência para quem não tem escopo global.
    if (scope.all) throw new NotFoundError("Application not found.");
    throw new ForbiddenError("Você não tem acesso a este recurso.");
  }
  if (!scopeAllowsProject(scope, row.projectId)) throw new ForbiddenError("Você não tem acesso a este recurso.");
  return { projectId: row.projectId };
}

/** Exige escopo global (ex.: operações que mexem em todos os Projects). */
export async function requireGlobalScope(user: SessionUser): Promise<void> {
  if (!hasGlobalProjectScope(user.role)) throw new ForbiddenError();
}

export async function setUserProjectAccess(userId: string, projectIds: string[]): Promise<void> {
  const unique = [...new Set(projectIds)];
  const valid = await prisma.project.findMany({ where: { id: { in: unique } }, select: { id: true } });
  await prisma.$transaction([
    prisma.projectAccess.deleteMany({ where: { userId, projectId: { notIn: valid.map((p) => p.id) } } }),
    prisma.projectAccess.createMany({ data: valid.map((p) => ({ userId, projectId: p.id })), skipDuplicates: true }),
  ]);
}

export async function getUserProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.projectAccess.findMany({ where: { userId }, select: { projectId: true } });
  return rows.map((row) => row.projectId);
}
