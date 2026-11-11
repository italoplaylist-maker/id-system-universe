import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePrAction, statusFromWebhook } from "../src/lib/pr-sync";

const open = { state: "open", merged: false };

test("PR aberto no Universe: segue o GitHub e fecha o ultrapassado", () => {
  assert.deepEqual(decidePrAction({ pull: null, newerSameBranch: false, compareStatus: null }).kind, "mark");
  assert.deepEqual(decidePrAction({ pull: { state: "closed", merged: true }, newerSameBranch: false, compareStatus: null }), { kind: "mark", status: "MERGED", reason: "Já foi mergeado no GitHub." });
  assert.equal((decidePrAction({ pull: { state: "closed", merged: false }, newerSameBranch: false, compareStatus: null }) as { status: string }).status, "CLOSED");
  assert.equal(decidePrAction({ pull: open, newerSameBranch: true, compareStatus: "ahead" }).kind, "close", "há PR mais novo na mesma branch");
  assert.equal(decidePrAction({ pull: open, newerSameBranch: false, compareStatus: "identical" }).kind, "close", "nada a mergear");
  assert.equal(decidePrAction({ pull: open, newerSameBranch: false, compareStatus: "behind" }).kind, "close", "já está na principal");
  assert.equal(decidePrAction({ pull: open, newerSameBranch: false, compareStatus: "ahead" }).kind, "keep");
  assert.equal(decidePrAction({ pull: open, newerSameBranch: false, compareStatus: "diverged" }).kind, "keep", "divergido pode ter trabalho novo: não fecha sozinho");
  assert.equal(decidePrAction({ pull: open, newerSameBranch: false, compareStatus: null }).kind, "keep", "sem resposta do GitHub: não fecha");
});

test("webhook: fechado, mergeado e reaberto", () => {
  assert.equal(statusFromWebhook("closed", true), "MERGED");
  assert.equal(statusFromWebhook("closed", false), "CLOSED");
  assert.equal(statusFromWebhook("closed", undefined), "CLOSED");
  assert.equal(statusFromWebhook("reopened", false), "OPEN");
  assert.equal(statusFromWebhook("opened", false), null);
});
