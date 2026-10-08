import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getProjectScope, scopeAllowsProject, type ProjectScope } from "@/server/auth/project-access";
import type { SessionUser } from "@/server/auth/session";

/** Cobrança visível = o usuário enxerga o Project dela (ou é global). Cobrança sem Project: só global. */
export function chargeWhere(scope: ProjectScope): Prisma.ChargeWhereInput {
  return scope.all ? {} : { projectId: { in: scope.projectIds } };
}

export function recurrenceWhere(scope: ProjectScope): Prisma.BillingRecurrenceWhereInput {
  return scope.all ? {} : { projectId: { in: scope.projectIds } };
}

export function clientWhere(scope: ProjectScope): Prisma.ClientWhereInput {
  if (scope.all) return {};
  return { OR: [{ projects: { some: { projectId: { in: scope.projectIds } } } }, { charges: { some: { projectId: { in: scope.projectIds } } } }] };
}

export async function assertChargeAccess(user: SessionUser, chargeId: string): Promise<{ projectId: string | null; clientId: string }> {
  const row = await prisma.charge.findUnique({ where: { id: chargeId }, select: { projectId: true, clientId: true } });
  const scope = await getProjectScope(user);
  if (!row) {
    if (scope.all) throw new NotFoundError("Cobrança não encontrada.");
    throw new ForbiddenError("Você não tem acesso a esta cobrança.");
  }
  if (!scopeAllowsProject(scope, row.projectId)) throw new ForbiddenError("Você não tem acesso a esta cobrança.");
  return row;
}

export async function assertRecurrenceAccess(user: SessionUser, recurrenceId: string): Promise<void> {
  const row = await prisma.billingRecurrence.findUnique({ where: { id: recurrenceId }, select: { projectId: true } });
  const scope = await getProjectScope(user);
  if (!row) {
    if (scope.all) throw new NotFoundError("Recorrência não encontrada.");
    throw new ForbiddenError("Você não tem acesso a esta recorrência.");
  }
  if (!scopeAllowsProject(scope, row.projectId)) throw new ForbiddenError("Você não tem acesso a esta recorrência.");
}

export async function assertClientAccess(user: SessionUser, clientId: string): Promise<void> {
  const scope = await getProjectScope(user);
  const found = await prisma.client.findFirst({ where: { id: clientId, ...clientWhere(scope) }, select: { id: true } });
  if (!found) {
    if (scope.all) throw new NotFoundError("Cliente não encontrado.");
    throw new ForbiddenError("Você não tem acesso a este cliente.");
  }
}

/** Para criar/editar: o Project informado precisa estar no escopo; sem Project exige escopo global. */
export function assertScopeAllowsProject(scope: ProjectScope, projectId: string | null | undefined): void {
  if (!scopeAllowsProject(scope, projectId ?? null)) throw new ForbiddenError("Você não tem acesso a este projeto.");
}
