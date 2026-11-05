import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Anexos dos comandos (imagens, PDFs, planilhas, qualquer arquivo). O conteúdo fica em DISCO fora de qualquer repositório;
 * o banco guarda só o registro. Imagens seguem como imagem para o Claude; os demais arquivos o agente lê pelo caminho.
 */
export const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 10,
  maxTotalBytes: 60 * 1024 * 1024,
  /** Acima disto a API do Claude recusa a imagem inline: vai como arquivo (o agente lê pelo caminho). */
  maxInlineImageBytes: 4_500_000,
} as const;

export const attachmentsDir = () => process.env.AGENT_ATTACHMENTS_DIR || join(homedir(), "attachments");

export interface AttachmentView {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
}

const toView = (a: { id: string; name: string; mime: string; size: number; kind: string }): AttachmentView => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind === "image" ? "image" : "file" });

/** Só confia no CONTEÚDO (bytes iniciais), nunca na extensão/tipo declarado. SVG não entra como imagem (pode carregar script). */
export function sniffImage(b: Buffer): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function safeName(raw: string): string {
  const base = basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").replace(/[<>:"|?*]/g, "_").trim().slice(0, 120);
  return base && base !== "." && base !== ".." ? base : "arquivo";
}

export async function saveUpload(userId: string, file: { name: string; type?: string; bytes: Buffer }): Promise<AttachmentView> {
  if (file.bytes.length === 0) throw new ValidationError("O arquivo está vazio.");
  if (file.bytes.length > LIMITS.maxFileBytes) throw new ValidationError(`O arquivo passa de ${LIMITS.maxFileBytes / 1024 / 1024} MB.`);
  const image = sniffImage(file.bytes);
  const id = randomUUID();
  const dir = join(attachmentsDir(), "uploads");
  await mkdir(dir, { recursive: true });
  const storedPath = join(dir, id);
  await writeFile(storedPath, file.bytes, { mode: 0o600 });
  const mime = image ?? (/^[a-z]+\/[a-z0-9.+-]+$/i.test(file.type ?? "") && !/svg|html|javascript/i.test(file.type ?? "") ? (file.type as string) : "application/octet-stream");
  const row = await prisma.agentAttachment.create({ data: { id, userId, name: safeName(file.name), mime, size: file.bytes.length, kind: image ? "image" : "file", storedPath } });
  return toView(row);
}

/** Confere ANTES de criar a tarefa: são do usuário, ainda soltos e dentro dos limites. */
export async function validateForTask(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length > LIMITS.maxFiles) throw new ValidationError(`No máximo ${LIMITS.maxFiles} anexos por comando.`);
  const rows = await prisma.agentAttachment.findMany({ where: { id: { in: ids } } });
  if (rows.length !== new Set(ids).size) throw new ValidationError("Algum anexo não foi encontrado (envie de novo).");
  if (rows.some((r) => r.userId !== userId || r.taskId !== null)) throw new ValidationError("Algum anexo não pode ser usado (já enviado ou de outra pessoa).");
  if (rows.reduce((n, r) => n + r.size, 0) > LIMITS.maxTotalBytes) throw new ValidationError(`Os anexos somam mais de ${LIMITS.maxTotalBytes / 1024 / 1024} MB.`);
}

export async function linkToTask(ids: string[], taskId: string): Promise<void> {
  if (ids.length > 0) await prisma.agentAttachment.updateMany({ where: { id: { in: ids }, taskId: null }, data: { taskId } });
}

export async function listForTask(taskId: string): Promise<AttachmentView[]> {
  return (await prisma.agentAttachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } })).map(toView);
}

export interface RunAttachment {
  name: string;
  mime: string;
  kind: "image" | "file";
  size: number;
  /** Caminho legível pelo agente (cópia com o nome original, numa pasta só desta tarefa). */
  path: string;
}

/** Prepara os anexos da tarefa para o agente: cópia com nome legível numa pasta própria da tarefa (liberada para leitura). */
export async function prepareForRun(taskId: string): Promise<{ attachments: RunAttachment[]; dir: string | null }> {
  const rows = await prisma.agentAttachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { attachments: [], dir: null };
  const dir = join(attachmentsDir(), "tasks", taskId);
  await mkdir(dir, { recursive: true });
  const used = new Set<string>();
  const out: RunAttachment[] = [];
  for (const r of rows) {
    let name = safeName(r.name);
    let i = 1;
    while (used.has(name.toLowerCase())) name = `${i++}-${safeName(r.name)}`;
    used.add(name.toLowerCase());
    const path = join(dir, name);
    await copyFile(r.storedPath, path);
    out.push({ name: r.name, mime: r.mime, kind: r.kind === "image" ? "image" : "file", size: r.size, path });
  }
  return { attachments: out, dir };
}

export async function readFor(id: string): Promise<{ bytes: Buffer; view: AttachmentView }> {
  const a = await prisma.agentAttachment.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Anexo não encontrado.");
  return { bytes: await readFile(a.storedPath), view: toView(a) };
}

export async function deleteUnlinked(id: string, userId: string): Promise<void> {
  const a = await prisma.agentAttachment.findUnique({ where: { id } });
  if (!a || a.userId !== userId || a.taskId) return;
  await rm(a.storedPath, { force: true });
  await prisma.agentAttachment.delete({ where: { id } });
}

/** Apaga arquivos de tarefas antigas (chamado junto da limpeza do histórico) e uploads que nunca viraram comando. */
export async function purgeAttachments(opts: { taskIds?: string[]; unlinkedOlderThanMs?: number } = {}): Promise<number> {
  const where = opts.taskIds ? { taskId: { in: opts.taskIds } } : { taskId: null, createdAt: { lt: new Date(Date.now() - (opts.unlinkedOlderThanMs ?? 24 * 3_600_000)) } };
  const rows = await prisma.agentAttachment.findMany({ where });
  for (const r of rows) await rm(r.storedPath, { force: true });
  for (const t of opts.taskIds ?? []) await rm(join(attachmentsDir(), "tasks", t), { recursive: true, force: true });
  if (rows.length > 0) await prisma.agentAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
}
