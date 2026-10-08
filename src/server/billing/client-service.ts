import { z } from "zod";
import type { Client } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { dateToCivil, todayInTimezone } from "@/lib/civil-date";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { getProjectScope, type ProjectScope } from "@/server/auth/project-access";
import { assertScopeAllowsProject, chargeWhere, clientWhere } from "@/server/billing/billing-access";
import { getBillingSettings } from "@/server/billing/settings";
import type { SessionUser } from "@/server/auth/session";

type Actor = { userId: string; ip?: string; userAgent?: string };

export interface ClientView {
  id: string;
  name: string;
  tradeName: string | null;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  projectIds: string[];
  createdAt: string;
}

function toView(client: Client & { projects: { projectId: string }[] }, visibleProjectIds?: string[]): ClientView {
  return {
    id: client.id,
    name: client.name,
    tradeName: client.tradeName,
    document: client.document,
    phone: client.phone,
    whatsapp: client.whatsapp,
    email: client.email,
    notes: client.notes,
    active: client.active,
    // Quem tem escopo restrito só enxerga os vínculos com os projetos que pode ver.
    projectIds: client.projects.map((p) => p.projectId).filter((id) => !visibleProjectIds || visibleProjectIds.includes(id)),
    createdAt: client.createdAt.toISOString(),
  };
}

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const clientSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do cliente.").max(160),
  tradeName: optionalText(160),
  document: optionalText(32),
  phone: optionalText(32),
  whatsapp: optionalText(32),
  email: z.string().trim().email("E-mail inválido.").max(200).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  notes: optionalText(2000),
  active: z.boolean().optional(),
  projectIds: z.array(z.string().min(1)).max(200).optional(),
});

function normalizeContactFields(data: z.infer<typeof clientSchema>): { phone: string | null; whatsapp: string | null } {
  const whatsapp = data.whatsapp ? normalizePhone(data.whatsapp) : null;
  if (data.whatsapp && !whatsapp) throw new ValidationError("WhatsApp inválido. Use DDD + número (ex.: (11) 99999-8888).");
  const phone = data.phone ? (normalizePhone(data.phone) ?? data.phone.replace(/[^\d+()\-\s]/g, "")) : null;
  return { phone, whatsapp };
}

export async function listClients(scope: ProjectScope, options: { q?: string; includeInactive?: boolean } = {}): Promise<ClientView[]> {
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        clientWhere(scope),
        options.includeInactive ? {} : { active: true },
        options.q ? { OR: [{ name: { contains: options.q, mode: "insensitive" } }, { tradeName: { contains: options.q, mode: "insensitive" } }] } : {},
      ],
    },
    include: { projects: { select: { projectId: true } } },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows.map((row) => toView(row, scope.all ? undefined : scope.projectIds));
}

export async function createClient(input: unknown, user: SessionUser, actor: Actor): Promise<ClientView> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  const scope = await getProjectScope(user);
  const projectIds = data.projectIds ?? [];
  for (const projectId of projectIds) assertScopeAllowsProject(scope, projectId);
  // Cliente sem nenhum projeto é "global": quem tem escopo restrito não consegue criar um que depois não enxerga.
  if (!scope.all && projectIds.length === 0) throw new ValidationError("Vincule o cliente a ao menos um projeto que você pode acessar.");

  const { phone, whatsapp } = normalizeContactFields(data);
  const client = await prisma.client.create({
    data: {
      name: data.name,
      tradeName: data.tradeName,
      document: data.document,
      phone,
      whatsapp,
      email: data.email,
      notes: data.notes,
      projects: { create: [...new Set(projectIds)].map((projectId) => ({ projectId })) },
    },
    include: { projects: { select: { projectId: true } } },
  });
  await recordAuditEvent({ userId: actor.userId, action: "CLIENT_CREATED", status: "SUCCESS", entityType: "Client", entityId: client.id, metadata: { name: client.name }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return toView(client);
}

export async function updateClient(id: string, input: unknown, user: SessionUser, actor: Actor): Promise<ClientView> {
  const parsed = clientSchema.partial().safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  const scope = await getProjectScope(user);
  const existing = await prisma.client.findFirst({ where: { id, ...clientWhere(scope) }, include: { projects: { select: { projectId: true } } } });
  if (!existing) throw new NotFoundError("Cliente não encontrado.");

  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.tradeName !== undefined) update.tradeName = data.tradeName;
  if (data.document !== undefined) update.document = data.document;
  if (data.email !== undefined) update.email = data.email;
  if (data.notes !== undefined) update.notes = data.notes;
  if (data.active !== undefined) update.active = data.active;
  if (data.whatsapp !== undefined || data.phone !== undefined) {
    const normalized = normalizeContactFields({ ...clientSchema.parse({ name: existing.name }), ...data });
    if (data.whatsapp !== undefined) update.whatsapp = normalized.whatsapp;
    if (data.phone !== undefined) update.phone = normalized.phone;
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id }, data: update });
    if (data.projectIds) {
      for (const projectId of data.projectIds) assertScopeAllowsProject(scope, projectId);
      // Só mexe nos vínculos que o usuário enxerga; os demais permanecem.
      const manageable = scope.all ? existing.projects.map((p) => p.projectId) : existing.projects.map((p) => p.projectId).filter((p) => scope.projectIds.includes(p));
      const wanted = new Set(data.projectIds);
      const toRemove = manageable.filter((p) => !wanted.has(p));
      if (toRemove.length > 0) await tx.clientProject.deleteMany({ where: { clientId: id, projectId: { in: toRemove } } });
      await tx.clientProject.createMany({ data: [...wanted].map((projectId) => ({ clientId: id, projectId })), skipDuplicates: true });
    }
  });
  await recordAuditEvent({ userId: actor.userId, action: "CLIENT_UPDATED", status: "SUCCESS", entityType: "Client", entityId: id, metadata: { fields: Object.keys(data) }, ipAddress: actor.ip, userAgent: actor.userAgent });
  const fresh = await prisma.client.findUniqueOrThrow({ where: { id }, include: { projects: { select: { projectId: true } } } });
  return toView(fresh, scope.all ? undefined : scope.projectIds);
}

export interface ClientDetail extends ClientView {
  totals: { receivedCents: number; pendingCents: number; overdueCents: number; nextDueDate: string | null };
  projects: { id: string; name: string }[];
  charges: { id: string; description: string; amountCents: number; dueDate: string; status: string; projectId: string | null }[];
  messages: { id: string; chargeId: string | null; status: string; kind: string; body: string; createdAt: string; error: string | null }[];
}

export async function getClientDetail(id: string, user: SessionUser): Promise<ClientDetail> {
  const scope = await getProjectScope(user);
  const client = await prisma.client.findFirst({ where: { id, ...clientWhere(scope) }, include: { projects: { select: { projectId: true } } } });
  if (!client) {
    if (scope.all) throw new NotFoundError("Cliente não encontrado.");
    throw new ForbiddenError("Você não tem acesso a este cliente.");
  }
  const settings = await getBillingSettings();
  const today = todayInTimezone(settings.timezone);
  const visible = chargeWhere(scope);
  const base = { clientId: id, AND: [visible] };

  const [charges, paid, pending, overdue, next, messages, projects] = await Promise.all([
    prisma.charge.findMany({ where: base, orderBy: { dueDate: "desc" }, take: 100 }),
    prisma.chargePayment.aggregate({ where: { charge: base, reversedAt: null }, _sum: { amountCents: true } }),
    prisma.charge.aggregate({ where: { ...base, status: "PENDING" }, _sum: { amountCents: true } }),
    prisma.charge.aggregate({ where: { ...base, status: "PENDING", dueDate: { lt: new Date(`${today}T00:00:00Z`) } }, _sum: { amountCents: true } }),
    prisma.charge.findFirst({ where: { ...base, status: "PENDING", dueDate: { gte: new Date(`${today}T00:00:00Z`) } }, orderBy: { dueDate: "asc" }, select: { dueDate: true } }),
    prisma.whatsAppMessage.findMany({ where: { clientId: id, ...(scope.all ? {} : { charge: visible }) }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.project.findMany({ where: { id: { in: client.projects.map((p) => p.projectId).filter((p) => scope.all || scope.projectIds.includes(p)) } }, select: { id: true, name: true } }),
  ]);

  return {
    ...toView(client, scope.all ? undefined : scope.projectIds),
    totals: {
      receivedCents: paid._sum.amountCents ?? 0,
      pendingCents: pending._sum.amountCents ?? 0,
      overdueCents: overdue._sum.amountCents ?? 0,
      nextDueDate: next ? dateToCivil(next.dueDate) : null,
    },
    projects,
    charges: charges.map((c) => ({ id: c.id, description: c.description, amountCents: c.amountCents, dueDate: dateToCivil(c.dueDate), status: c.status, projectId: c.projectId })),
    messages: messages.map((m) => ({ id: m.id, chargeId: m.chargeId, status: m.status, kind: m.kind, body: m.body, createdAt: m.createdAt.toISOString(), error: m.error })),
  };
}

