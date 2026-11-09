import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma, resetDb } from "./helpers";
import { createMcp, deleteSkill, listMcp, listSkills, loadMcpServersForRun, readGlobalClaudeMd, saveSkill, seedGlobalClaudeMd, writeGlobalClaudeMd } from "@/server/orchestrator/tools-config";

const realHome = process.env.HOME;
const SKILL = "---\nname: revisar\ndescription: Revisa código antes do commit\n---\n\nPasso a passo.\n";

describe("ferramentas dos agentes (skills, CLAUDE.md, MCP)", () => {
  before(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "isu-home-"));
  });
  after(async () => {
    process.env.HOME = realHome;
    await prisma.$disconnect();
  });
  beforeEach(resetDb);

  it("salva, lista e remove skill; exige cabeçalho e nome seguro", async () => {
    await saveSkill({ name: "revisar", content: SKILL });
    const list = await listSkills();
    assert.equal(list.length, 1);
    assert.equal(list[0].description, "Revisa código antes do commit");
    await assert.rejects(() => saveSkill({ name: "../fora", content: SKILL }), /Nome da skill/);
    await assert.rejects(() => saveSkill({ name: "sem-cabecalho", content: "texto solto" }), /cabeçalho/);
    await deleteSkill("revisar");
    assert.equal((await listSkills()).length, 0);
  });

  it("CLAUDE.md global: grava e lê", async () => {
    assert.equal(await readGlobalClaudeMd(), "");
    await writeGlobalClaudeMd("Sempre responda em português.");
    assert.equal(await readGlobalClaudeMd(), "Sempre responda em português.");
  });

  it("CLAUDE.md global padrão: semeia as regras do cérebro só quando não existe nada, e nunca sobrescreve", async () => {
    rmSync(join(process.env.HOME!, ".claude", "CLAUDE.md"), { force: true });
    assert.equal(await seedGlobalClaudeMd(), true);
    const md = await readGlobalClaudeMd();
    for (const s of ["cerebro-do-brabo", "Consulte antes de decidir", "Não invente memória", "publish_changes", "Não peça permissão"]) assert.ok(md.includes(s), `contém: ${s}`);
    await writeGlobalClaudeMd("Meu texto próprio.");
    assert.equal(await seedGlobalClaudeMd(), false);
    assert.equal(await readGlobalClaudeMd(), "Meu texto próprio.");
  });

  it("MCP: segredos cifrados no banco, nunca voltam pela listagem e chegam ao SDK decifrados", async () => {
    await createMcp({ name: "github", type: "stdio", command: "npx", args: ["-y", "server-github"], secrets: { GITHUB_TOKEN: "ghp_segredo123" } });
    const row = await prisma.agentMcpServer.findFirstOrThrow();
    assert.ok(!row.secretsEnc!.includes("ghp_segredo123"));
    const [view] = await listMcp();
    assert.deepEqual(view.secretKeys, ["GITHUB_TOKEN"]);
    assert.ok(!JSON.stringify(view).includes("ghp_segredo123"));
    const run = (await loadMcpServersForRun()) as Record<string, { env?: Record<string, string> }>;
    assert.equal(run.github.env?.GITHUB_TOKEN, "ghp_segredo123");
    await assert.rejects(() => createMcp({ name: "github", type: "stdio", command: "x" }), /Já existe/);
    await assert.rejects(() => createMcp({ name: "sem-comando", type: "stdio" }), /comando/);
  });
});
