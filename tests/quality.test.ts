import { test } from "node:test";
import assert from "node:assert/strict";
import { QUALITY_ORDER, QUALITY_PROFILES, readStoredQuality } from "../src/components/universe/hq/render/quality";

test("níveis de qualidade: custo decresce de alto para baixo", () => {
  const [high, medium, low] = QUALITY_ORDER.map((q) => QUALITY_PROFILES[q]);
  assert.ok(high.shadowMapSize > medium.shadowMapSize && medium.shadowMapSize > low.shadowMapSize);
  assert.ok(high.dpr[1] >= medium.dpr[1] && medium.dpr[1] >= low.dpr[1]);
  assert.equal(low.shadows, false);
  assert.equal(low.environment, false);
  assert.equal(low.richMaterials, false);
  assert.equal(high.contactShadows && !medium.contactShadows, true);
});

test("sem window (servidor), a preferência padrão é alto e nunca lança", () => {
  assert.equal(readStoredQuality(), "high");
});
