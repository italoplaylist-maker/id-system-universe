import { prisma } from "@/server/db/client";

/**
 * Qual repositório GitHub é o deste agente. Ordem: (1) o ligado DIRETO ao agente (escolhido na própria central);
 * (2) o do primeiro recurso do projeto que tenha repositório (jeito antigo, continua valendo).
 */
export async function pickAgentRepository(agent: { githubRepositoryId: string | null; githubBranch: string | null; projectId: string | null }) {
  if (agent.githubRepositoryId) {
    const gh = await prisma.gitHubRepository.findUnique({ where: { id: agent.githubRepositoryId }, include: { installation: true } });
    if (gh) return { gh, branch: agent.githubBranch || null, source: "agent" as const };
  }
  if (agent.projectId) {
    const link = await prisma.resourceRepository.findFirst({
      where: { application: { projectId: agent.projectId }, githubRepositoryId: { not: null } },
      include: { githubRepository: { include: { installation: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (link?.githubRepository) return { gh: link.githubRepository, branch: link.branch || null, source: "project" as const };
  }
  return null;
}
