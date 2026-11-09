import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

/**
 * O schema.prisma e as migrações têm que dizer a MESMA coisa. Já aconteceu de uma coluna entrar no schema sem migração:
 * o código novo consultava a coluna, o banco de produção não tinha, e a lista de agentes quebrou (INTERNAL_ERROR).
 * Pré-requisito (o mesmo dos outros testes): as migrações já aplicadas no TEST_DATABASE_URL.
 */
describe("schema do Prisma × migrações", () => {
  it("não há diferença entre o banco migrado e o schema.prisma", () => {
    const url = process.env.TEST_DATABASE_URL;
    assert.ok(url, "defina TEST_DATABASE_URL");
    const r = spawnSync("npx", ["prisma", "migrate", "diff", "--from-url", url!, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const sql = r.stdout.replace(/^-- This is an empty migration\.\s*$/m, "").trim();
    assert.equal(sql, "", `Faltam migrações para o schema atual. Rode "prisma migrate dev --name <o_que_mudou>" e commite. SQL que falta:\n${sql}`);
  });
});
