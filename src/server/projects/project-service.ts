import { z } from "zod";
import { prisma } from "@/server/db/client";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Application, Project } from "@prisma/client";
import type { ProjectSuggestion, UniverseProject, UniverseProjectDetail, UniverseProjectHealth } from "@/types/domain";
import { toUniverseApplication } from "@/server/applications/application-mapper";

type ApplicationForHealth = Pick<Application, "status" | "pendingOperation">;

/**
 * Aggregate project health, derived only from resource states we actually
 * know — never invented. DEPLOYING takes priority because it's the most
 * actionable thing to surface; HEALTHY only when every known resource is
 * RUNNING; OFFLINE only when none are; anything mixed is DEGRADED.
 */
export function computeProjectHealth(resources: ApplicationForHealth[]): UniverseProjectHealth {
  if (resources.length === 0) return "UNKNOWN";
  if (resources.some((r) => r.pendingOperation === "REDEPLOY" || r.pendingOperation === "FORCE_REDEPLOY")) return "DEPLOYING";

  const known = resources.filter((r) => r.status !== "UNKNOWN");
  if (known.length === 0) return "UNKNOWN";

  const runningCount = known.filter((r) => r.status === "RUNNING").length;
  if (runningCount === known.length) return "HEALTHY";
  if (runningCount === 0) return "OFFLINE";
  return "DEGRADED";
}

function toUniverseProject(project: Project & { resources: (ApplicationForHealth & { providerId: string })[] }): UniverseProject {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    icon: project.icon,
    accent: project.accent,
    enabled: project.enabled,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    health: computeProjectHealth(project.resources),
    resourceCount: project.resources.length,
    providerCount: new Set(project.resources.map((r) => r.providerId)).size,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function listProjects(options: { includeArchived?: boolean } = {}): Promise<UniverseProject[]> {
  const rows = await prisma.project.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    include: { resources: { select: { status: true, pendingOperation: true, providerId: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(toUniverseProject);
}

export async function getProjectRowOrThrow(id: string) {
  const row = await prisma.project.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Project not found.");
  return row;
}

export async function getProjectDetail(id: string): Promise<UniverseProjectDetail> {
  const row = await prisma.project.findUnique({
    where: { id },
    include: { resources: { include: { provider: true }, orderBy: { name: "asc" } } },
  });
  if (!row) throw new NotFoundError("Project not found.");

  const summary = toUniverseProject({
    ...row,
    resources: row.resources.map((r) => ({ status: r.status, pendingOperation: r.pendingOperation, providerId: r.providerId })),
  });

  return { ...summary, resources: row.resources.map((r) => toUniverseApplication({ ...r, project: row })) };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export async function createProject(input: unknown, actor: { userId: string; ip?: string; userAgent?: string }): Promise<UniverseProject> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const baseSlug = slugify(parsed.data.name);
  if (!baseSlug) throw new ValidationError("Project name must contain at least one letter or number.");

  let slug = baseSlug;
  for (let attempt = 1; await prisma.project.findUnique({ where: { slug } }); attempt++) {
    slug = `${baseSlug}-${attempt + 1}`;
  }

  const row = await prisma.project.create({
    data: {
      name: parsed.data.name,
      slug,
      description: parsed.data.description,
      icon: parsed.data.icon,
      accent: parsed.data.accent ?? "#38bdf8",
    },
  });

  await recordAuditEvent({
    userId: actor.userId,
    projectId: row.id,
    action: "PROJECT_CREATED",
    status: "SUCCESS",
    metadata: { name: row.name, slug: row.slug },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return toUniverseProject({ ...row, resources: [] });
}

const updateProjectSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function updateProject(
  id: string,
  input: unknown,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<UniverseProject> {
  await getProjectRowOrThrow(id);
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const row = await prisma.project.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon,
      accent: parsed.data.accent,
      enabled: parsed.data.enabled,
      archivedAt: parsed.data.archived === undefined ? undefined : parsed.data.archived ? new Date() : null,
    },
    include: { resources: { select: { status: true, pendingOperation: true, providerId: true } } },
  });

  await recordAuditEvent({
    userId: actor.userId,
    projectId: id,
    action: parsed.data.archived === true ? "PROJECT_ARCHIVED" : parsed.data.archived === false ? "PROJECT_UNARCHIVED" : "PROJECT_UPDATED",
    status: "SUCCESS",
    metadata: { changedFields: Object.keys(parsed.data) },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });

  return toUniverseProject(row);
}

export async function deleteProject(id: string, actor: { userId: string; ip?: string; userAgent?: string }): Promise<void> {
  const row = await getProjectRowOrThrow(id);
  // Resources are never deleted — Application.projectId just goes back to
  // null (SetNull FK), so they reappear as Unassigned rather than vanishing.
  await prisma.project.delete({ where: { id } });
  await recordAuditEvent({
    userId: actor.userId,
    action: "PROJECT_DELETED",
    status: "SUCCESS",
    metadata: { name: row.name, slug: row.slug },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

export async function listUnassignedResources() {
  const rows = await prisma.application.findMany({
    where: { projectId: null },
    include: { provider: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => toUniverseApplication(r));
}

const assignSchema = z.object({ resourceIds: z.array(z.string().min(1)).min(1) });

export async function assignResourcesToProject(
  projectId: string,
  input: unknown,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<{ assigned: number }> {
  const project = await getProjectRowOrThrow(projectId);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const resources = await prisma.application.findMany({ where: { id: { in: parsed.data.resourceIds } } });
  if (resources.length === 0) throw new NotFoundError("No matching resources found.");

  await prisma.application.updateMany({ where: { id: { in: resources.map((r) => r.id) } }, data: { projectId } });

  for (const resource of resources) {
    await recordAuditEvent({
      userId: actor.userId,
      projectId,
      applicationId: resource.id,
      providerId: resource.providerId,
      action: "RESOURCE_ASSIGNED",
      status: "SUCCESS",
      metadata: { resourceName: resource.name, projectName: project.name },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  }
  await recordUniverseEvent({
    type: "RESOURCE_ASSIGNED",
    message: `${resources.length} resource(s) assigned to ${project.name}.`,
    projectId,
    projectName: project.name,
  });

  return { assigned: resources.length };
}

export async function unassignResource(
  resourceId: string,
  actor: { userId: string; ip?: string; userAgent?: string },
): Promise<void> {
  const resource = await prisma.application.findUnique({ where: { id: resourceId } });
  if (!resource) throw new NotFoundError("Resource not found.");
  if (!resource.projectId) throw new ConflictError("This resource is already unassigned.");

  const previousProject = await prisma.project.findUnique({ where: { id: resource.projectId } });

  await prisma.application.update({ where: { id: resourceId }, data: { projectId: null } });

  await recordAuditEvent({
    userId: actor.userId,
    applicationId: resource.id,
    providerId: resource.providerId,
    action: "RESOURCE_UNASSIGNED",
    status: "SUCCESS",
    metadata: { resourceName: resource.name, previousProjectName: previousProject?.name },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

const STEM_SUFFIXES = ["-web", "-api", "-app", "-db", "-database", "-postgres", "-postgresql", "-redis", "-worker", "-bot", "-chatbot", "-service", "-svc"];

function guessStem(resourceName: string): string {
  const lower = resourceName.toLowerCase();
  const suffix = STEM_SUFFIXES.find((s) => lower.endsWith(s));
  if (suffix) return lower.slice(0, -suffix.length);
  const dashIndex = lower.indexOf("-");
  return dashIndex > 0 ? lower.slice(0, dashIndex) : lower;
}

/**
 * Groups unassigned resources by a guessed name "stem" (e.g. "italoc-web" and
 * "italoc-api" both stem to "italoc"). Only suggests an existing project when
 * the stem matches its name or slug exactly — anything ambiguous is left for
 * the admin to decide, per spec ("não associe automaticamente quando houver
 * ambiguidade").
 */
export async function suggestProjectAssignments(): Promise<ProjectSuggestion[]> {
  const unassigned = await prisma.application.findMany({ where: { projectId: null }, select: { id: true, name: true } });
  if (unassigned.length === 0) return [];

  const projects = await prisma.project.findMany({ where: { archivedAt: null }, select: { id: true, name: true, slug: true } });

  const groups = new Map<string, { id: string; name: string }[]>();
  for (const resource of unassigned) {
    const stem = guessStem(resource.name);
    if (!stem) continue;
    const list = groups.get(stem) ?? [];
    list.push(resource);
    groups.set(stem, list);
  }

  const suggestions: ProjectSuggestion[] = [];
  for (const [stem, resources] of groups) {
    if (resources.length < 2) continue; // a lone resource isn't a confident grouping signal
    const matched = projects.find((p) => slugify(p.name) === stem || p.slug === stem);
    suggestions.push({
      stem,
      resourceIds: resources.map((r) => r.id),
      resourceNames: resources.map((r) => r.name),
      matchedProjectId: matched?.id ?? null,
      matchedProjectName: matched?.name ?? null,
    });
  }

  return suggestions;
}
