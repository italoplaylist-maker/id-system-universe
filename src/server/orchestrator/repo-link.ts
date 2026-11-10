import { prisma } from "@/server/db/client";
import { slugDir } from "@/lib/repo-dir";

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

/** Onde ficam os repositórios EXTRAS de um agente: ao lado da cópia principal, nunca dentro dela (o Git da principal não os enxerga). */
export const extrasRoot = (agentCwd: string) => `${agentCwd}.extras`;
export const extraDir = (agentCwd: string, dir: string) => `${extrasRoot(agentCwd)}/${dir}`;

export async function listExtraRepos(agentId: string) {
  return prisma.agentRepository.findMany({ where: { agentId }, include: { githubRepository: { include: { installation: true } } }, orderBy: { createdAt: "asc" } });
}

/** Um repositório do agente pelo identificador: "primary"/vazio = principal; senão o id do extra, o nome da subpasta ou "dono/nome". */
export async function findAgentRepoRef(agentId: string, ref?: string | null): Promise<{ kind: "primary" } | { kind: "extra"; id: string } | null> {
  const r = (ref ?? "").trim();
  if (!r || r === "primary") return { kind: "primary" };
  const extras = await listExtraRepos(agentId);
  const hit = extras.find((e) => e.id === r || e.dir === r || e.githubRepository.fullName.toLowerCase() === r.toLowerCase());
  if (hit) return { kind: "extra", id: hit.id };
  const primary = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { githubRepository: { select: { fullName: true } } } });
  if (primary?.githubRepository?.fullName.toLowerCase() === r.toLowerCase()) return { kind: "primary" };
  return null;
}

/** Nome de subpasta livre para o repositório (acrescenta -2, -3… se já houver). */
export async function freeExtraDir(agentId: string, repoName: string): Promise<string> {
  const used = new Set((await prisma.agentRepository.findMany({ where: { agentId }, select: { dir: true } })).map((x) => x.dir));
  const base = slugDir(repoName);
  let name = base;
  for (let i = 2; used.has(name); i += 1) name = `${base}-${i}`;
  return name;
}
