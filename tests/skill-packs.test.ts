import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma, resetDb } from "./helpers";
import { installPack, listPacks, seedDefaultPacks } from "@/server/orchestrator/skill-packs";
import { listSkills } from "@/server/orchestrator/tools-config";

const realHome = process.env.HOME;

describe("kits de skills embutidos (Motion)", () => {
  before(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "isu-home-"));
  });
  after(async () => {
    process.env.HOME = realHome;
    await prisma.$disconnect();
  });
  beforeEach(resetDb);

  it("instala skill + subagente no ~/.claude (valem para todos os agentes) sem ligar o MCP externo", async () => {
    assert.equal((await listPacks())[0].skillsInstalled, false);
    await installPack("motion", { withMcp: false });
    const home = process.env.HOME!;
    assert.ok(existsSync(join(home, ".claude", "skills", "motion", "SKILL.md")));
    assert.ok(existsSync(join(home, ".claude", "skills", "motion", "best-practices", "react.md")));
    assert.ok(existsSync(join(home, ".claude", "agents", "motion-reviewer.md")));
    const skills = await listSkills();
    assert.ok(skills.some((s) => s.name === "motion" && /Animation skill/.test(s.description ?? "")));
    const [p] = await listPacks();
    assert.equal(p.skillsInstalled, true);
    assert.equal(p.mcpInstalled, false, "MCP é opt-in");
    assert.equal(await prisma.agentMcpServer.count(), 0);
  });

  it("MCP só quando pedido, sem duplicar; reinstalar é seguro", async () => {
    await installPack("motion", { withMcp: true });
    await installPack("motion", { withMcp: true });
    const rows = await prisma.agentMcpServer.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, "https://mcp.motion.dev");
    assert.equal(rows[0].type, "http");
    assert.equal((await listPacks())[0].mcpInstalled, true);
  });

  it("no boot os kits entram sozinhos (só arquivos) e não sobrescrevem o que já está instalado", async () => {
    await seedDefaultPacks();
    const skillFile = join(process.env.HOME!, ".claude", "skills", "motion", "SKILL.md");
    assert.ok(existsSync(skillFile));
    assert.equal(await prisma.agentMcpServer.count(), 0, "seed não liga MCP externo");
    const before = readFileSync(skillFile, "utf8");
    await seedDefaultPacks();
    assert.equal(readFileSync(skillFile, "utf8"), before);
  });

  it("kit inexistente é recusado", async () => {
    await assert.rejects(() => installPack("nao-existe", { withMcp: false }), /não encontrado/);
  });
});
