import { test } from "node:test";
import assert from "node:assert/strict";
import { hqFixture } from "./hq-fixture";
import { CLT_DX, CLT_ROOM, COMMERCIAL_ISLAND } from "../src/components/universe/hq/plan/clt-layout";

for (const [np, na, nc] of [[3, 2, 7], [6, 6, 7], [8, 14, 14]] as const) {
  test(`mundo em Y (${np} projetos, ${na} agentes, ${nc} CLT): toda mesa e todo ponto do átrio se alcançam`, () => {
    const { world: w, projects, agents, clt } = hqFixture(np, na, nc);
    const desks = [...projects, ...agents, ...clt].map((x) => w.desks.get(x.id)!);
    assert.equal(desks.length, np + na + nc);
    const origin = w.desks.get(agents[0].id)!.approach;
    assert.ok(w.grid.isFree(origin.x, origin.z), "ponto de aproximação da primeira mesa deveria ser livre");
    for (const d of desks) {
      assert.ok(w.grid.isFree(d.approach.x, d.approach.z), `aproximação de ${d.id} bloqueada`);
      const path = w.grid.findPath(origin, d.approach);
      assert.ok(path && path.length > 0, `sem caminho até a mesa ${d.id}`);
    }
    w.wander.forEach((p, i) => {
      assert.ok(w.grid.isFree(p.x, p.z), `ponto de passeio ${i} bloqueado`);
      const path = w.grid.findPath(origin, p);
      assert.ok(path && path.length > 0, `sem caminho até o ponto de passeio ${i}`);
    });
  });
}

test("o assento de cada mesa (inclusive da sala CLT) aponta para a mesa (monitor à frente)", () => {
  const { world: w } = hqFixture(2, 4, 7);
  for (const d of w.desks.values()) {
    // a aproximação fica ATRÁS da cadeira: a direção assento→aproximação é oposta ao rumo do assento
    const fx = Math.sin(d.yaw);
    const fz = Math.cos(d.yaw);
    const dot = (d.approach.x - d.seat.x) * fx + (d.approach.z - d.seat.z) * fz;
    assert.ok(dot < -0.5, `${d.id}: a aproximação deveria estar atrás do assento (dot=${dot.toFixed(2)})`);
  }
});

test("a sala CLT é alcançável pela porta e as mesas dela ficam no nível da ala", () => {
  const { world: w, plan, clt } = hqFixture(3, 3, 7);
  const door = plan.wings.clt.door;
  const outside = { x: door.x - plan.wings.clt.u.x * 3, z: door.z - plan.wings.clt.u.z * 3 };
  assert.ok(w.grid.isFree(outside.x, outside.z), "átrio diante da porta da sala CLT deveria ser livre");
  for (const c of clt) {
    const d = w.desks.get(c.id)!;
    const path = w.grid.findPath(outside, d.approach);
    assert.ok(path && path.length > 0, `sem caminho da porta até ${c.id}`);
    assert.ok(Math.abs(plan.levelAt(d.seat.x, d.seat.z) - plan.wings.clt.level) < 1e-9, `${c.id} fora do nível da sala`);
  }
});

test("alturas: no átrio fica a +0,40 do nível operacional e a sala CLT está 0,20 abaixo dele", () => {
  const { plan } = hqFixture(3, 3);
  assert.ok(Math.abs(plan.levelAt(0, 0) - plan.wings.agents.level - 0.4) < 1e-9);
  assert.ok(Math.abs(plan.wings.clt.level - plan.wings.agents.level + 0.2) < 1e-9);
});

test("duas ilhas na MESMA sala: a ilha CLT não saiu do lugar, a comercial é separada e todos os funcionários dela são alcançáveis", () => {
  const { world: w, plan, clt, com, cltLayout } = hqFixture(3, 3, 7, 4);
  // CLT preservada: mesma geometria de antes, só deslocada pela largura nova (a porta continua no mesmo lugar)
  assert.equal(CLT_ROOM.width, 36);
  assert.ok(Math.abs(cltLayout.table.x - (-1.2 + CLT_DX)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(cltLayout.stations[0].x - cltLayout.table.x, cltLayout.stations[0].z - cltLayout.table.z) - 3.6) < 1e-9, "anel interno da CLT intacto");
  assert.equal(cltLayout.stations.length, 7);
  // separação visual: núcleos distantes e nenhuma estação comercial dentro do anel CLT
  const gap = Math.hypot(cltLayout.table.x - COMMERCIAL_ISLAND.x, cltLayout.table.z - COMMERCIAL_ISLAND.z);
  assert.ok(gap > 9, `ilhas muito coladas (${gap.toFixed(1)} m)`);
  for (const s of cltLayout.commercial.stations) {
    assert.ok(Math.hypot(s.x - cltLayout.table.x, s.z - cltLayout.table.z) > 7.5, "estação comercial invadiu a ilha CLT");
    assert.ok(Math.abs(s.x) < CLT_ROOM.width / 2 - 0.5 && Math.abs(s.z) < CLT_ROOM.depth / 2 - 0.5, "estação fora da sala");
  }
  // acessibilidade: da porta até cada mesa das duas equipes
  const door = plan.wings.clt.door;
  const outside = { x: door.x - plan.wings.clt.u.x * 3, z: door.z - plan.wings.clt.u.z * 3 };
  for (const c of [...clt, ...com]) {
    const d = w.desks.get(c.id)!;
    assert.ok(w.grid.isFree(d.approach.x, d.approach.z), `aproximação de ${c.id} bloqueada`);
    const path = w.grid.findPath(outside, d.approach);
    assert.ok(path && path.length > 0, `sem caminho da porta até ${c.id}`);
  }
  // sem equipe comercial, a CLT segue igual
  assert.equal(hqFixture(3, 3, 7, 0).cltLayout.commercial.stations.length, 0);
});
