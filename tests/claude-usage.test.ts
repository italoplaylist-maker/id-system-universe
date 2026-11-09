import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtReset, fmtTokens, mapPlanUsage } from "../src/lib/claude-usage";

test("fmtTokens: unidade, mil e milhão com vírgula", () => {
  assert.equal(fmtTokens(950), "950");
  assert.equal(fmtTokens(12_345), "12,3 mil");
  assert.equal(fmtTokens(20_000), "20 mil");
  assert.equal(fmtTokens(1_234_567), "1,2 mi");
  assert.equal(fmtTokens(0), "0");
});

test("fmtReset: minutos, horas e dias; passado ou vazio", () => {
  const now = Date.UTC(2026, 10, 9, 12, 0, 0);
  const at = (ms: number) => new Date(now + ms).toISOString();
  assert.equal(fmtReset(at(35 * 60_000), now), "35 min");
  assert.equal(fmtReset(at(130 * 60_000), now), "2h10");
  assert.equal(fmtReset(at((3 * 24 + 4) * 3600_000), now), "3d 4h");
  assert.equal(fmtReset(at(-5000), now), "agora");
  assert.equal(fmtReset(null, now), "—");
  assert.equal(fmtReset("lixo", now), "—");
});

test("mapPlanUsage: arredonda, limita 0–100 e trata conta sem limites", () => {
  const r = mapPlanUsage({
    subscription_type: "max",
    rate_limits_available: true,
    rate_limits: { five_hour: { utilization: 41.6, resets_at: "2026-11-09T15:00:00Z" }, seven_day: { utilization: 130, resets_at: null } },
  });
  assert.equal(r.plan, "max");
  assert.equal(r.fiveHour?.percent, 42);
  assert.equal(r.sevenDay?.percent, 100);
  const api = mapPlanUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null });
  assert.equal(api.planLimitsAvailable, false);
  assert.equal(api.fiveHour, null);
  assert.deepEqual(mapPlanUsage(null), { plan: null, planLimitsAvailable: false, fiveHour: null, sevenDay: null });
});
