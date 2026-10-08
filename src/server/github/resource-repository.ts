import { z } from "zod";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";

export interface ResourceRepositoryView {
  applicationId: string;
  githubRepositoryId: string | null;
  repositoryFullName: string;
  branch: string;
  autoDeploy: boolean;
  onPush: boolean;
  onMerge: boolean;
}

const schema = z.object({
  githubRepositoryId: z.string().min(1),
  branch: z.string().trim().regex(/^[\w./-]{1,200}$/, "Branch inválida."),
  autoDeploy: z.boolean().default(false),
  onPush: z.boolean().default(true),
  onMerge: z.boolean().default(true),
});

export async function getResourceRepository(applicationId: string): Promise<ResourceRepositoryView | null> {
  const row = await prisma.resourceRepository.findUnique({ where: { applicationId } });
  if (!row) return null;
  return {
    applicationId: row.applicationId,
    githubRepositoryId: row.githubRepositoryId,
    repositoryFullName: row.repositoryFullName,
    branch: row.branch,
    autoDeploy: row.autoDeploy,
    onPush: row.onPush,
    onMerge: row.onMerge,
  };
}

export async function setResourceRepository(applicationId: string, input: unknown, actor: { userId: string; ip?: string; userAgent?: string }): Promise<ResourceRepositoryView> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true, projectId: true, resourceType: true } });
  if (!application) throw new NotFoundError("Recurso não encontrado.");
  if (parsed.data.autoDeploy && application.resourceType !== "APPLICATION") {
    throw new ValidationError("Somente aplicações suportam deploy automático.");
  }
  const repo = await prisma.gitHubRepository.findUnique({ where: { id: parsed.data.githubRepositoryId } });
  if (!repo) throw new NotFoundError("Repositório não encontrado.");

  const data = {
    githubRepositoryId: repo.id,
    repositoryFullName: repo.fullName,
    branch: parsed.data.branch,
    autoDeploy: parsed.data.autoDeploy,
    onPush: parsed.data.onPush,
    onMerge: parsed.data.onMerge,
  };
  await prisma.resourceRepository.upsert({ where: { applicationId }, create: { applicationId, ...data }, update: data });
  await recordAuditEvent({
    userId: actor.userId,
    applicationId,
    projectId: application.projectId,
    action: "RESOURCE_REPOSITORY_LINKED",
    status: "SUCCESS",
    metadata: { repository: repo.fullName, branch: data.branch, autoDeploy: data.autoDeploy, onPush: data.onPush, onMerge: data.onMerge },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
  return (await getResourceRepository(applicationId)) as ResourceRepositoryView;
}

export async function removeResourceRepository(applicationId: string, actor: { userId: string; ip?: string; userAgent?: string }): Promise<void> {
  const row = await prisma.resourceRepository.findUnique({ where: { applicationId }, include: { application: { select: { projectId: true } } } });
  if (!row) return;
  await prisma.resourceRepository.delete({ where: { applicationId } });
  await recordAuditEvent({
    userId: actor.userId,
    applicationId,
    projectId: row.application.projectId,
    action: "RESOURCE_REPOSITORY_UNLINKED",
    status: "SUCCESS",
    metadata: { repository: row.repositoryFullName, branch: row.branch },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}
