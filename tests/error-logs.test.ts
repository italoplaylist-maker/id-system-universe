import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLogLine, extractErrorEvents, fingerprintOf, groupEvents, isErrorLine, lineIdentity, onlyNew } from "../src/lib/error-logs";

test("o que é erro: palavras de erro (PT e EN), sem confundir 'sem erros' / 'errors: 0'", () => {
  for (const l of ["Error: connect ECONNREFUSED 10.0.0.5:5432", "TypeError: Cannot read properties of undefined", "FATAL: password authentication failed", "[ERRO] falha ao emitir nota", "unhandled promise rejection", "Process exited: out of memory"]) assert.equal(isErrorLine(l), true, l);
  for (const l of ["Build finished with 0 errors", "errors: 0", "failed=0", "Verificação concluída: sem erros", "no errors found", "GET /api/health 200 3ms", "Server listening on :3000"]) assert.equal(isErrorLine(l), false, l);
  assert.equal(classifyLogLine("npm warn deprecated foo@1"), "WARN");
  assert.equal(classifyLogLine("error: boom"), "ERROR");
  assert.equal(classifyLogLine("tudo certo"), "INFO");
});

test("o mesmo erro com hora, números e ids diferentes tem a mesma impressão digital; erros diferentes não", () => {
  const a = "2026-11-10T08:00:01.123Z Error: connect ECONNREFUSED 10.0.0.5:5432 (request 8f14e45f-ea34-4b2d-8c1a-123456789abc)";
  const b = "2026-11-10T09:30:59.001Z Error: connect ECONNREFUSED 10.0.0.9:5432 (request 11111111-2222-4333-8444-555555555555)";
  const c = "2026-11-10T09:30:59.001Z Error: relation \"Foo\" does not exist";
  assert.equal(fingerprintOf(a), fingerprintOf(b));
  assert.notEqual(fingerprintOf(a), fingerprintOf(c));
  assert.notEqual(lineIdentity(a), lineIdentity(b), "mas a identidade exata da linha é diferente");
});

test("stack trace entra no erro como contexto (com limite) e não vira outro erro", () => {
  const lines = ["ok", "Error: boom", "    at fn (/app/a.js:1:1)", "    at run (/app/b.js:2:2)", "caused by: x", "próxima linha normal", "Error: outro"];
  const ev = extractErrorEvents(lines);
  assert.equal(ev.length, 2);
  assert.deepEqual(ev[0].context, ["    at fn (/app/a.js:1:1)", "    at run (/app/b.js:2:2)", "caused by: x"]);
  assert.equal(ev[1].line, "Error: outro");
  const long = ["Error: x", ...Array.from({ length: 30 }, (_, i) => `    at f${i}`)];
  assert.equal(extractErrorEvents(long, 6)[0].context.length, 6);
});

test("não conta duas vezes a mesma linha em leituras seguidas, e agrupa por impressão digital", () => {
  const first = extractErrorEvents(["2026-11-10 08:00:01 Error: db timeout 30s", "2026-11-10 08:00:09 Error: db timeout 31s"]);
  assert.equal(groupEvents(first).length, 1);
  assert.equal(groupEvents(first)[0].count, 2);
  const seen = new Set(first.map((e) => e.identity));
  // a leitura seguinte repete as duas linhas antigas e traz uma nova
  const second = extractErrorEvents(["2026-11-10 08:00:01 Error: db timeout 30s", "2026-11-10 08:00:09 Error: db timeout 31s", "2026-11-10 08:15:00 Error: db timeout 29s"]);
  const fresh = onlyNew(second, seen);
  assert.equal(fresh.length, 1);
  assert.match(fresh[0].line, /08:15:00/);
  assert.equal(groupEvents(fresh)[0].fingerprint, groupEvents(first)[0].fingerprint, "continua sendo o mesmo erro");
});
