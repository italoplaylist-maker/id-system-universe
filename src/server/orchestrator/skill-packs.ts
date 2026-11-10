import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { claudeHome, createMcp } from "./tools-config";

/**
 * Kits prontos de skills (arquivos versionados dentro do próprio Universe, em /skill-packs).
 * Instalar = copiar para o ~/.claude do servidor → vale para TODOS os agentes. Nada de executar `npx` de terceiros em produção.
 */
interface Pack {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  /** Subpastas em skill-packs/<id>/skills que viram ~/.claude/skills/<nome>. */
  skills: string[];
  /** Arquivos em skill-packs/<id>/agents que viram ~/.claude/agents/<arquivo> (subagentes). */
  agents: string[];
  /** Servidores MCP opcionais (cadastrados só quando você pede). */
  mcp: Array<{ name: string; url: string }>;
}

const PACKS: Pack[] = [
  {
    id: "motion",
    name: "Motion (animação)",
    description: "Boas práticas de animação (Motion/Framer Motion e CSS), busca na documentação, molas CSS, auditoria de performance e um subagente revisor.",
    version: "14.2.0",
    license: "MIT — Motion (motion.dev)",
    skills: ["motion"],
    agents: ["motion-reviewer.md"],
    mcp: [{ name: "motion", url: "https://mcp.motion.dev" }],
  },
  {
    id: "find-skills",
    name: "Find Skills (descobrir skills)",
    description: "Ensina o agente a procurar e sugerir skills instaláveis quando você pede algo especializado (vercel-labs/skills).",
    version: "1.7.6",
    license: "MIT — Vercel, Inc. (vercel-labs/skills)",
    skills: ["find-skills"],
    agents: [],
    mcp: [],
  },
];

const packDir = (id: string) => join(process.cwd(), "skill-packs", id);
const exists = (p: string) => stat(p).then(() => true, () => false);

export interface PackView {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  skillsInstalled: boolean;
  mcpInstalled: boolean;
  mcpAvailable: boolean;
}

export async function listPacks(): Promise<PackView[]> {
  const mcpNames = new Set((await prisma.agentMcpServer.findMany({ select: { name: true } })).map((m) => m.name));
  return Promise.all(
    PACKS.map(async (p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      license: p.license,
      skillsInstalled: (await Promise.all(p.skills.map((s) => exists(join(claudeHome(), "skills", s, "SKILL.md"))))).every(Boolean),
      mcpInstalled: p.mcp.length > 0 && p.mcp.every((m) => mcpNames.has(m.name)),
      mcpAvailable: p.mcp.length > 0,
    })),
  );
}

/** Copia skills e subagentes do kit para o ~/.claude (global). Seguro repetir: sobrescreve com a versão do kit. */
export async function installPackFiles(id: string): Promise<void> {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) throw new NotFoundError("Kit não encontrado.");
  const src = packDir(id);
  if (!(await exists(src))) throw new NotFoundError("Os arquivos do kit não vieram nesta versão do Universe.");
  for (const skill of pack.skills) {
    await mkdir(join(claudeHome(), "skills"), { recursive: true });
    await cp(join(src, "skills", skill), join(claudeHome(), "skills", skill), { recursive: true });
  }
  if (pack.agents.length > 0) {
    await mkdir(join(claudeHome(), "agents"), { recursive: true });
    for (const a of pack.agents) await cp(join(src, "agents", a), join(claudeHome(), "agents", a));
  }
}

/** Instala os arquivos e (se pedido) cadastra os servidores MCP do kit. */
export async function installPack(id: string, opts: { withMcp: boolean }): Promise<void> {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) throw new NotFoundError("Kit não encontrado.");
  await installPackFiles(id);
  if (opts.withMcp) {
    for (const m of pack.mcp) {
      if (await prisma.agentMcpServer.findUnique({ where: { name: m.name } })) continue;
      await createMcp({ name: m.name, type: "http", url: m.url });
    }
  }
}

/** No boot: kits cujos arquivos ainda não estão no servidor entram sozinhos (só arquivos locais — o MCP externo continua opt-in). */
export async function seedDefaultPacks(): Promise<void> {
  for (const p of PACKS) {
    try {
      const done = (await Promise.all(p.skills.map((s) => exists(join(claudeHome(), "skills", s, "SKILL.md"))))).every(Boolean);
      if (!done && (await exists(packDir(p.id)))) {
        await installPackFiles(p.id);
        logger.info("skill_pack_seeded", { pack: p.id });
      }
    } catch (error) {
      logger.warn("skill_pack_seed_failed", { pack: p.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
}
