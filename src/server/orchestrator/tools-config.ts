import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/server/crypto/encryption";
import { redactSecrets } from "@/server/claude/agent-service";
import { claudeBinary } from "./claude-auth";

/** Tudo que deixa o agente do Universe parecido com o Claude Code: skills, CLAUDE.md global, MCPs e plugins. */

export const claudeHome = () => join(process.env.HOME || homedir(), ".claude");

// ---------------------------------------------------------------- skills
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_FILE = 100_000;

/** Lê name/description do cabeçalho do SKILL.md, inclusive blocos YAML dobrados (`description: >` + linhas recuadas). */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const get = (key: string): string | undefined => {
    const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (i < 0) return undefined;
    const first = lines[i].replace(new RegExp(`^${key}:\\s*`), "").trim();
    if (/^[>|][+-]?$/.test(first)) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && (lines[j] === "" || /^\s+/.test(lines[j])); j += 1) body.push(lines[j].trim());
      return body.join(" ").replace(/\s+/g, " ").trim() || undefined;
    }
    return first.replace(/^["']|["']$/g, "") || undefined;
  };
  return { name: get("name"), description: get("description") };
}

export interface SkillView {
  name: string;
  description: string | null;
  content: string;
}

export async function listSkills(): Promise<SkillView[]> {
  const dir = join(claudeHome(), "skills");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: SkillView[] = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const content = await readFile(join(dir, e.name, "SKILL.md"), "utf8").catch(() => null);
    if (content === null) continue;
    out.push({ name: e.name, description: parseFrontmatter(content).description ?? null, content: content.slice(0, MAX_FILE) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSkill(input: unknown): Promise<void> {
  const parsed = z.object({ name: z.string().trim(), content: z.string() }).safeParse(input);
  if (!parsed.success) throw new ValidationError("Informe o nome e o conteúdo da skill.");
  const { name, content } = parsed.data;
  if (!SKILL_NAME.test(name)) throw new ValidationError("Nome da skill: letras minúsculas, números e hífen (ex.: revisar-codigo).");
  if (content.length > MAX_FILE) throw new ValidationError("A skill pode ter no máximo 100 mil caracteres.");
  const fm = parseFrontmatter(content);
  if (!fm.name || !fm.description) throw new ValidationError("O SKILL.md precisa começar com um cabeçalho `---` contendo `name:` e `description:`.");
  await mkdir(join(claudeHome(), "skills", name), { recursive: true });
  await writeFile(join(claudeHome(), "skills", name, "SKILL.md"), content, "utf8");
}

export async function deleteSkill(name: string): Promise<void> {
  if (!SKILL_NAME.test(name)) throw new ValidationError("Nome inválido.");
  await rm(join(claudeHome(), "skills", name), { recursive: true, force: true });
}

// ---------------------------------------------------------------- CLAUDE.md global
export async function readGlobalClaudeMd(): Promise<string> {
  return readFile(join(claudeHome(), "CLAUDE.md"), "utf8").catch(() => "");
}

export async function writeGlobalClaudeMd(content: unknown): Promise<void> {
  if (typeof content !== "string" || content.length > MAX_FILE) throw new ValidationError("Conteúdo inválido (máx. 100 mil caracteres).");
  await mkdir(claudeHome(), { recursive: true });
  await writeFile(join(claudeHome(), "CLAUDE.md"), content, "utf8");
}

// ---------------------------------------------------------------- MCP
const mcpSchema = z
  .object({
    name: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, "Nome do MCP: letras, números, _ e -."),
    type: z.enum(["stdio", "http", "sse"]),
    command: z.string().trim().max(300).optional(),
    args: z.array(z.string().max(500)).max(40).optional(),
    url: z.string().trim().url().max(500).optional(),
    /** env (stdio) ou headers (http/sse): guardado cifrado. */
    secrets: z.record(z.string().max(200), z.string().max(4000)).optional(),
  })
  .refine((v) => (v.type === "stdio" ? !!v.command : !!v.url), "Informe o comando (stdio) ou a URL (http/sse).");

export interface McpView {
  id: string;
  name: string;
  type: string;
  command: string | null;
  args: string[];
  url: string | null;
  secretKeys: string[];
  enabled: boolean;
}

function secretsOf(row: { secretsEnc: string | null }): Record<string, string> {
  if (!row.secretsEnc) return {};
  try {
    return JSON.parse(decryptSecret(row.secretsEnc)) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function listMcp(): Promise<McpView[]> {
  const rows = await prisma.agentMcpServer.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, command: r.command, args: r.args, url: r.url, secretKeys: Object.keys(secretsOf(r)), enabled: r.enabled }));
}

export async function createMcp(input: unknown): Promise<void> {
  const parsed = mcpSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const v = parsed.data;
  if (await prisma.agentMcpServer.findUnique({ where: { name: v.name } })) throw new ValidationError("Já existe um MCP com esse nome.");
  await prisma.agentMcpServer.create({
    data: { name: v.name, type: v.type, command: v.command ?? null, args: v.args ?? [], url: v.url ?? null, secretsEnc: v.secrets && Object.keys(v.secrets).length ? encryptSecret(JSON.stringify(v.secrets)) : null },
  });
}

export async function setMcpEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await prisma.agentMcpServer.updateMany({ where: { id }, data: { enabled } });
  if (r.count === 0) throw new NotFoundError("MCP não encontrado.");
}

export async function deleteMcp(id: string): Promise<void> {
  await prisma.agentMcpServer.deleteMany({ where: { id } });
}

/** Configuração entregue ao SDK em cada execução (segredos decifrados só em memória). */
export async function loadMcpServersForRun(): Promise<Record<string, unknown>> {
  const rows = await prisma.agentMcpServer.findMany({ where: { enabled: true } });
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const secrets = secretsOf(r);
    if (r.type === "stdio") out[r.name] = { type: "stdio", command: r.command, args: r.args, ...(Object.keys(secrets).length ? { env: secrets } : {}) };
    else out[r.name] = { type: r.type, url: r.url, ...(Object.keys(secrets).length ? { headers: secrets } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------- plugins (via CLI oficial)
function cli(args: string[], timeoutMs = 120_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(claudeBinary(), args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (clearTimeout(t), resolve({ code, out })));
    p.on("error", (e) => (clearTimeout(t), resolve({ code: null, out: e.message })));
  });
}

const PLUGIN_VALUE = /^[A-Za-z0-9._@/:#~-]{1,200}$/;

export async function listPlugins(): Promise<{ installed: unknown[]; marketplaces: unknown[] }> {
  const parse = (out: string): unknown[] => {
    try {
      const v = JSON.parse(out.slice(out.search(/[[{]/)));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const [a, b] = await Promise.all([cli(["plugin", "list", "--json"], 20_000), cli(["plugin", "marketplace", "list", "--json"], 20_000)]);
  return { installed: parse(a.out), marketplaces: parse(b.out) };
}

export async function pluginAction(input: unknown): Promise<string> {
  const parsed = z.object({ action: z.enum(["marketplace-add", "install", "uninstall", "enable", "disable"]), value: z.string().trim() }).safeParse(input);
  if (!parsed.success || !PLUGIN_VALUE.test(parsed.data.value)) throw new ValidationError("Valor inválido. Use o formato plugin@marketplace ou owner/repositorio.");
  const { action, value } = parsed.data;
  const args = action === "marketplace-add" ? ["plugin", "marketplace", "add", value] : ["plugin", action, value];
  const r = await cli(args);
  const text = redactSecrets(r.out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")).trim().slice(-600);
  if (r.code !== 0) throw new ValidationError(text || "O comando de plugin falhou.");
  return text;
}

// ---------------------------------------------------------------- CLAUDE.md global padrão (semente)
/** Regras de todos os agentes: o resumo operacional do CLAUDE.md do "Cérebro do Brabo". Só é gravado se ainda não existir um CLAUDE.md global. */
export const DEFAULT_GLOBAL_CLAUDE_MD = `# Regras de todos os agentes do ID System Universe

Você trabalha para o Italo. Responda sempre em português do Brasil, direto ao ponto.

## O Cérebro do Brabo (memória externa)
Existe um repositório extra chamado **cerebro-do-brabo**: a memória persistente do Italo (contexto, decisões, regras de negócio, bugs resolvidos, aprendizados por projeto).
O caminho dele aparece na sua mensagem inicial (pasta ao lado da sua cópia, terminada em \`.extras/cerebro-do-brabo\`). **Consulte-o SEMPRE antes de executar qualquer tarefa relevante** e leia o CLAUDE.md dele: lá estão as regras completas. Se o cérebro não estiver conectado, avise o Italo.

## As 6 regras (resumo)
1. **Consulte antes de decidir.** Identifique o projeto; leia \`01 - Projetos/<Projeto>/Contexto.md\`, \`Arquitetura.md\`, \`Regras de Negocio.md\`, \`Decisoes.md\`; busque sintomas parecidos em \`06 - Bugs e Solucoes\` e a tecnologia em \`02 - Conhecimento\`. Faça buscas direcionadas (grep), não leia o vault inteiro.
2. **Não misture projetos.** O que vale para um projeto não vale para outro por padrão. Algo realmente global vai para \`02 - Conhecimento\` ou \`04 - Arquitetura\`.
3. **Respeite decisões registradas.** Não as substitua em silêncio: se houver motivo técnico para mudar, diga qual; ao mudar de fato, registre uma decisão nova e marque a antiga como substituída.
4. **Não invente memória.** Se não está no cérebro, escreva "Informação não documentada." e pergunte ao Italo. Nunca preencha lacuna com suposição.
5. **Registre o que vale daqui a seis meses**: decisão arquitetural, regra de negócio, bug que custou tempo, padrão reutilizável, aprendizado, integração, mudança estrutural. Uma nota por assunto, no lugar certo, com o template e os índices do vault. Não registre commits triviais.
6. **Não deixe trabalho pendurado.** Ao terminar: valide (teste, lint, typecheck, build — o que existir), envie com \`publish_changes\` (branch + PR), faça o merge com \`merge_pull_request\` (só com verificações verdes) e registre no cérebro (\`publish_changes\` com repo="cerebro-do-brabo" e merge). Se um passo não puder ser feito, diga qual e por quê — não pule em silêncio. Nunca mergeie sem validar, nunca force histórico em branch que não é sua, e quando o Italo pedir revisão o merge é dele.

## Autonomia
Não peça permissão para executar comandos, editar arquivos ou pesquisar: faça. Pare e pergunte só diante de ambiguidade real de negócio, de ação destrutiva fora da sua pasta, ou de algo que contrarie uma decisão registrada.
Nunca coloque senhas, tokens ou chaves em código, commit ou nota.
`;

/** Primeira subida: se não há CLAUDE.md global, grava o padrão. Nunca sobrescreve o que você já escreveu. */
export async function seedGlobalClaudeMd(): Promise<boolean> {
  const current = await readGlobalClaudeMd();
  if (current.trim().length > 0) return false;
  await writeGlobalClaudeMd(DEFAULT_GLOBAL_CLAUDE_MD);
  return true;
}
