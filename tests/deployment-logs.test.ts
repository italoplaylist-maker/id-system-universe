import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDeploymentLogs } from "../src/providers/deployment/coolify/coolify-mapper";

test("log do deploy em JSON: junta as saídas, pula as 'hidden' e classifica erro/aviso", () => {
  const raw = JSON.stringify([
    { output: "Starting deployment of app.\nPulling image", timestamp: "2026-11-09T12:00:00Z", hidden: false },
    { output: "docker inspect --format ...", timestamp: "2026-11-09T12:00:01Z", hidden: true },
    { output: "npm WARN deprecated foo@1", timestamp: "2026-11-09T12:00:05Z", hidden: false },
    { output: "Error: build failed", timestamp: "2026-11-09T12:00:09Z", hidden: false },
    { output: 42 },
  ]);
  const lines = mapDeploymentLogs(raw);
  assert.deepEqual(lines.map((l) => l.raw), ["Starting deployment of app.", "Pulling image", "npm WARN deprecated foo@1", "Error: build failed"]);
  assert.deepEqual(lines.map((l) => l.level), ["INFO", "INFO", "WARN", "ERROR"]);
  assert.equal(lines[0].timestamp, "2026-11-09T12:00:00Z");
});

test("log do deploy em texto puro, vazio e JSON que não é lista", () => {
  assert.deepEqual(mapDeploymentLogs("linha 1\n\nlinha 2 failed").map((l) => [l.raw, l.level]), [["linha 1", "INFO"], ["linha 2 failed", "ERROR"]]);
  assert.deepEqual(mapDeploymentLogs(null), []);
  assert.deepEqual(mapDeploymentLogs(""), []);
  assert.deepEqual(mapDeploymentLogs('{"a":1}').map((l) => l.raw), ['{"a":1}']);
});
