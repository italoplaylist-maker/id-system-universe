import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHqPlan, HQ, wingWorldRect } from "../src/components/universe/hq/plan/hq-plan";
import { inOrect, toWorld } from "../src/components/universe/hq/life/geometry";

const plan = computeHqPlan({ tech: { width: 12.5, depth: 10.5 }, agents: { width: 11, depth: 14 }, clt: { width: 18, depth: 15 } });

test("a porta de cada ala fica na parede voltada para o átrio (+x local)", () => {
  for (const id of ["tech", "agents", "clt"] as const) {
    const w = plan.wings[id];
    const p = toWorld(w, { x: w.width / 2, z: 0 });
    assert.ok(Math.hypot(p.x - w.door.x, p.z - w.door.z) < 1e-6, `${id}: porta local ≠ porta no mundo`);
  }
});

test("alas têm direções distintas e não se sobrepõem", () => {
  const rects = Object.values(plan.wings).map(wingWorldRect);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      // amostra uma grade: nenhum ponto pode estar dentro de duas alas
      for (let x = -40; x <= 40; x += 0.5) for (let z = -40; z <= 40; z += 0.5) assert.ok(!(inOrect(x, z, rects[i]) && inOrect(x, z, rects[j])), `alas ${i} e ${j} se sobrepõem em ${x},${z}`);
    }
  }
  const headings = new Set(Object.values(HQ.HEADING).map((h) => h.toFixed(3)));
  assert.equal(headings.size, 3);
});

test("níveis: átrio +0,40, alas nos seus níveis, rampa interpola na porta", () => {
  assert.equal(plan.levelAt(0, 0), HQ.ATRIUM_LEVEL);
  const clt = plan.wings.clt;
  assert.equal(plan.levelAt(clt.x, clt.z), clt.level);
  const mid = plan.levelAt(clt.door.x + clt.u.x * (HQ.RAMP_LENGTH / 2), clt.door.z + clt.u.z * (HQ.RAMP_LENGTH / 2));
  assert.ok(mid < HQ.ATRIUM_LEVEL && mid > clt.level, `rampa no meio deveria estar entre os níveis, veio ${mid}`);
  const a = plan.wings.agents;
  assert.equal(plan.levelAt(a.x, a.z), HQ.LEVEL.agents);
  const t = plan.wings.tech;
  assert.equal(plan.levelAt(t.x, t.z), HQ.LEVEL.tech);
  assert.equal(plan.levelAt(100, 100), 0);
});

test("a caixa envolvente contém todas as alas", () => {
  for (const w of Object.values(plan.wings)) {
    const r = wingWorldRect(w);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = toWorld({ x: r.cx, z: r.cz, rot: r.rot }, { x: sx * r.hx, z: sz * r.hz });
      assert.ok(p.x >= plan.bounds.minX && p.x <= plan.bounds.maxX && p.z >= plan.bounds.minZ && p.z <= plan.bounds.maxZ);
    }
  }
});
