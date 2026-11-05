import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { makeUser, prisma, resetDb } from "./helpers";
import { LIMITS, prepareForRun, purgeAttachments, safeName, saveUpload, sniffImage } from "@/server/orchestrator/attachments";
import { buildPrompt } from "@/server/orchestrator/executor";
import { createAgent, getTaskDetail, submitTask } from "@/server/orchestrator/service";
import { setExecutor, type ExecutorRunInput } from "@/server/orchestrator/executor";
import { setWorkspacePreparer } from "@/server/orchestrator/workspace";
import { dispatch, idle } from "@/server/orchestrator/worker";

// PNG 1x1 real
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
let n = 0;
const key = () => `att-key-${Date.now()}-${(n += 1)}`;

describe("anexos do comando (imagem, arquivo)", () => {
  before(() => {
    process.env.AGENT_ATTACHMENTS_DIR = mkdtempSync(join(tmpdir(), "isu-att-"));
  });
  after(async () => {
    setExecutor(null);
    setWorkspacePreparer(null);
    await prisma.$disconnect();
  });
  let userId: string;
  let agentId: string;
  const actor = () => ({ userId });
  beforeEach(async () => {
    await resetDb();
    userId = (await makeUser("ADMIN", "owner@x.com")).id;
    agentId = (await createAgent({ name: "Ana", cwd: "/srv/app" }, actor())).id;
    setWorkspacePreparer(async () => undefined);
  });

  it("só confia no conteúdo: PNG vira imagem; SVG com script e tipo mentiroso viram arquivo", async () => {
    assert.equal(sniffImage(PNG), "image/png");
    assert.equal(sniffImage(SVG), null);
    const img = await saveUpload(userId, { name: "foto.png", type: "application/pdf", bytes: PNG });
    assert.equal(img.kind, "image");
    assert.equal(img.mime, "image/png", "tipo declarado ignorado");
    const svg = await saveUpload(userId, { name: "x.svg", type: "image/svg+xml", bytes: SVG });
    assert.equal(svg.kind, "file");
    assert.equal(svg.mime, "application/octet-stream", "SVG nunca é servido como imagem");
    assert.equal(safeName("../../etc/passwd"), "passwd");
    assert.equal(safeName("a\\b\\c:d?.txt"), "c_d_.txt");
  });

  it("limites: vazio, grande demais, mais de 10, de outra pessoa ou já usado", async () => {
    await assert.rejects(() => saveUpload(userId, { name: "a", bytes: Buffer.alloc(0) }), /vazio/);
    await assert.rejects(() => saveUpload(userId, { name: "a", bytes: Buffer.alloc(LIMITS.maxFileBytes + 1) }), /passa de/);
    const a = await saveUpload(userId, { name: "a.pdf", bytes: PDF });
    const other = (await makeUser("ADMIN", "o@x.com")).id;
    await assert.rejects(() => submitTask(agentId, { prompt: "x", idempotencyKey: key(), attachmentIds: [a.id] }, { userId: other }), /não pode ser usado/);
    await assert.rejects(() => submitTask(agentId, { prompt: "x", idempotencyKey: key(), attachmentIds: Array.from({ length: 11 }, (_, i) => `id${i}`) }, actor()), /No máximo 10/);
    await submitTask(agentId, { prompt: "x", idempotencyKey: key(), attachmentIds: [a.id] }, actor());
    await assert.rejects(() => submitTask(agentId, { prompt: "y", idempotencyKey: key(), attachmentIds: [a.id] }, actor()), /não pode ser usado/, "anexo já usado");
  });

  it("comando só com anexo é aceito; sem texto e sem anexo não", async () => {
    await assert.rejects(() => submitTask(agentId, { prompt: "", idempotencyKey: key() }, actor()), /Escreva o comando ou anexe/);
    const a = await saveUpload(userId, { name: "foto.png", bytes: PNG });
    const { task } = await submitTask(agentId, { prompt: "", idempotencyKey: key(), attachmentIds: [a.id] }, actor());
    assert.equal(task.prompt, "Veja os anexos.");
    const d = await getTaskDetail(task.id);
    assert.equal(d.attachments.length, 1);
    assert.match(d.events[0].text ?? "", /📎 foto\.png/);
  });

  it("o agente recebe a imagem como bloco de imagem e o arquivo como caminho legível", async () => {
    const img = await saveUpload(userId, { name: "tela.png", bytes: PNG });
    const pdf = await saveUpload(userId, { name: "relatório.pdf", bytes: PDF });
    const seen: ExecutorRunInput[] = [];
    setExecutor({
      async run(input) {
        seen.push(input);
        await input.onStarted({ sessionId: "s" });
        return { result: "ok" };
      },
    });
    const { task } = await submitTask(agentId, { prompt: "analise", idempotencyKey: key(), attachmentIds: [img.id, pdf.id] }, actor());
    await dispatch();
    await idle();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(seen[0], "executor foi chamado");
    assert.equal(seen[0].attachments?.length, 2);
    const pdfPath = seen[0].attachments!.find((a) => a.kind === "file")!.path;
    assert.equal(readFileSync(pdfPath).equals(PDF), true, "cópia legível com o conteúdo original");
    assert.ok(seen[0].attachmentsDir && pdfPath.startsWith(seen[0].attachmentsDir));
    // prompt montado
    const built = (await buildPrompt({ prompt: "analise", attachments: seen[0].attachments })) as AsyncIterable<{ message: { content: Array<Record<string, unknown>> } }>;
    const msgs: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    for await (const m of built) msgs.push(m);
    const content = msgs[0].message.content;
    assert.equal(content[0].type, "image");
    assert.equal((content[0].source as { media_type: string }).media_type, "image/png");
    assert.match(String(content[content.length - 1].text), /ferramenta Read[\s\S]*relatório\.pdf/);
    assert.equal(await buildPrompt({ prompt: "sem anexo", attachments: [] }), "sem anexo", "sem anexo segue texto puro");
    void task;
  });

  it("limpeza: apaga arquivos da tarefa e uploads soltos antigos", async () => {
    const a = await saveUpload(userId, { name: "a.pdf", bytes: PDF });
    const { task } = await submitTask(agentId, { prompt: "x", idempotencyKey: key(), attachmentIds: [a.id] }, actor());
    const { dir } = await prepareForRun(task.id);
    const stored = (await prisma.agentAttachment.findFirstOrThrow()).storedPath;
    assert.ok(existsSync(stored) && existsSync(dir!));
    await purgeAttachments({ taskIds: [task.id] });
    assert.equal(existsSync(stored), false);
    assert.equal(existsSync(dir!), false);
    const loose = await saveUpload(userId, { name: "solto.pdf", bytes: PDF });
    await prisma.agentAttachment.update({ where: { id: loose.id }, data: { createdAt: new Date(Date.now() - 48 * 3_600_000) } });
    assert.equal(await purgeAttachments(), 1);
  });
});
