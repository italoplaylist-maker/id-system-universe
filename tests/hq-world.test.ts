import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAgentPods, computeOfficeLayout } from "../src/components/universe/hq/office/office-layout";
import { officePropObstacles } from "../src/components/universe/hq/office/office-props";
import { computeHqPlan, HQ } from "../src/components/universe/hq/plan/hq-plan";
import { atriumObstacles } from "../src/components/universe/hq/plan/atrium-layout";
import { computeLoungeLayout, LOUNGE_MIN_DEPTH, LOUNGE_WIDTH } from "../src/components/universe/hq/life/lounge-layout";
import { buildLifeWorldFromPlan } from "../src/components/universe/hq/life/world";
import { partitionDoorZ } from "../src/components/universe/hq/office/office-shell";

function world(nProjects: number, nAgents: number) {
  const projects = Array.from({ length: nProjects }, (_, i) => ({ id: `p${i}`, name: `Projeto ${i}`, accent: "#38bdf8" }));
  const agents = Array.from({ length: nAgents }, (_, i) => ({ id: `a${i}`, name: `Agente ${i}`, accent: "#e8283f" }));
  const tech = computeOfficeLayout(projects, [{ id: "r1", name: "VPS", color: "#34d399" }]);
  const pods = computeAgentPods(agents);
  const lounge = computeLoungeLayout(HQ.DOOR_DIST, LOUNGE_MIN_DEPTH, 0);
  const plan = computeHqPlan({
    tech: { width: tech.width, depth: tech.depth, doorZ: partitionDoorZ(tech.depth) },
    agents: { width: pods.width, depth: pods.depth, doorZ: pods.aisleZ },
    lounge: { width: LOUNGE_WIDTH, depth: LOUNGE_MIN_DEPTH },
  });
  const w = buildLifeWorldFromPlan({
    plan,
    techDesks: tech.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z })),
    techObstacles: officePropObstacles(tech),
    agentDesks: pods.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z, yaw: d.yaw ?? 0 })),
    agentObstacles: [],
    lounge,
    atriumObstacles: atriumObstacles(),
  });
  return { w, plan, lounge, projects, agents };
}

for (const [np, na] of [[3, 2], [6, 6], [8, 14]] as const) {
  test(`mundo em Y (${np} projetos, ${na} agentes): toda mesa e todo assento do lounge se alcançam`, () => {
    const { w, lounge, projects, agents } = world(np, na);
    const desks = [...projects, ...agents].map((x) => w.desks.get(x.id)!);
    assert.equal(desks.length, np + na);
    const origin = w.desks.get(agents[0].id)!.approach;
    assert.ok(w.grid.isFree(origin.x, origin.z), "ponto de aproximação da primeira mesa deveria ser livre");
    for (const d of desks) {
      assert.ok(w.grid.isFree(d.approach.x, d.approach.z), `aproximação de ${d.id} bloqueada`);
      const path = w.grid.findPath(origin, d.approach);
      assert.ok(path && path.length > 0, `sem caminho até a mesa ${d.id}`);
    }
    for (const seat of lounge.seats) {
      const path = w.grid.findPath(origin, seat.approach);
      assert.ok(path && path.length > 0, `sem caminho até o assento ${seat.id}`);
    }
  });
}

test("o assento de cada mesa de agente aponta para a mesa (monitor à frente)", () => {
  const { w } = world(2, 4);
  for (const d of w.desks.values()) {
    // a aproximação fica ATRÁS da cadeira: a direção assento→aproximação é oposta ao rumo do assento
    const fx = Math.sin(d.yaw);
    const fz = Math.cos(d.yaw);
    const dot = (d.approach.x - d.seat.x) * fx + (d.approach.z - d.seat.z) * fz;
    assert.ok(dot < -0.5, `${d.id}: a aproximação deveria estar atrás do assento (dot=${dot.toFixed(2)})`);
  }
});

test("alturas: personagem na porta do lounge desce a rampa; no átrio fica a +0,40 do nível operacional", () => {
  const { plan } = world(3, 3);
  assert.ok(Math.abs(plan.levelAt(0, 0) - plan.wings.agents.level - 0.4) < 1e-9);
  assert.ok(Math.abs(plan.wings.lounge.level - plan.wings.agents.level + 0.2) < 1e-9);
});
