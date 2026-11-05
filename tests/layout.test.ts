import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentAccent, orderAgentSessions } from "@/lib/agent-order";
import { computeOfficeLayout, OFFICE } from "@/components/universe/hq/office/office-layout";
import { computeLoungeLayout, LOUNGE_MIN_DEPTH, LOUNGE_WIDTH } from "@/components/universe/hq/life/lounge-layout";
import { PoolGame } from "@/components/universe/hq/life/pool-game";
import { makeRng } from "@/components/universe/hq/life/geometry";

const proj = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${String(i).padStart(3, "0")}`, accent: "#fff" }));

describe("layout compacto", () => {
  it("16 projetos cabem numa sala bem menor que antes (era ~18,4 × 18,9 m)", () => {
    const l = computeOfficeLayout(proj(16), []);
    assert.ok(l.width <= 13.5, `largura ${l.width}`);
    assert.ok(l.depth <= 16, `profundidade ${l.depth}`);
    assert.equal(l.desks.length, 16);
  });

  it("mesas não se sobrepõem e respeitam o espaçamento mínimo", () => {
    const l = computeOfficeLayout(proj(16), []);
    for (let i = 0; i < l.desks.length; i += 1) {
      for (let j = i + 1; j < l.desks.length; j += 1) {
        const dx = Math.abs(l.desks[i].x - l.desks[j].x);
        const dz = Math.abs(l.desks[i].z - l.desks[j].z);
        assert.ok(dx >= OFFICE.SLOT_X - 1e-6 || dz >= OFFICE.SLOT_Z - 1e-6, `mesas ${i} e ${j} coladas`);
      }
    }
  });

  it("nenhuma mesa invade a parede lateral", () => {
    const l = computeOfficeLayout(proj(16), []);
    for (const d of l.desks) assert.ok(Math.abs(d.x) + 1.25 <= l.width / 2, "mesa encosta na parede");
  });

  it("lounge: dois grupos de sofá, 3 poltronas e 7 banquetas, tudo dentro da sala", () => {
    const l = computeLoungeLayout(30, LOUNGE_MIN_DEPTH, LOUNGE_MIN_DEPTH / 2 - 1.9);
    assert.equal(l.width, LOUNGE_WIDTH);
    assert.equal(l.furniture.sofas.length, 2);
    assert.equal(l.furniture.armchairs.length, 3);
    assert.equal(l.furniture.stools.length, 7);
    assert.equal(l.seats.filter((s) => s.kind === "sofa").length, 6);
    assert.equal(l.seats.filter((s) => s.kind === "stool").length, 7);
    for (const s of l.seats) {
      assert.ok(s.pos.x > l.x0 && s.pos.x < l.x0 + l.width, `${s.id} fora da sala (x)`);
      assert.ok(s.pos.z > l.minZ && s.pos.z < l.maxZ, `${s.id} fora da sala (z)`);
    }
  });
});

describe("sinuca (PoolGame)", () => {
  it("o ponto do atirador fica na linha bola-alvo → branca, atrás da branca, ao alcance", () => {
    const g = new PoolGame();
    const rng = makeRng(5);
    for (let k = 0; k < 40; k += 1) {
      const plan = g.plan([], rng);
      assert.ok(plan, "sempre há uma jogada");
      const cue = { x: g.pos[0], z: g.pos[1] };
      const obj = { x: g.pos[plan.target * 2], z: g.pos[plan.target * 2 + 1] };
      // o corpo mira exatamente na direção branca → alvo
      const aim = Math.atan2(obj.x - cue.x, obj.z - cue.z);
      assert.ok(Math.abs(Math.atan2(Math.sin(aim - plan.yaw), Math.cos(aim - plan.yaw))) < 1e-6);
      // e está atrás da branca (o vetor stand→branca aponta para o alvo)
      const back = (cue.x - plan.stand.x) * Math.sin(plan.yaw) + (cue.z - plan.stand.z) * Math.cos(plan.yaw);
      assert.ok(back > 0 && back <= 2.3, `alcance ${back}`);
      g.strike(plan);
      for (let t = 0; t < 8; t += 0.05) g.step(0.05);
      assert.ok(g.settled);
    }
  });

  it("ninguém é posto em cima de outro jogador", () => {
    const g = new PoolGame();
    const plan = g.plan([{ x: 0, z: 1.4 }, { x: 0, z: -1.4 }], makeRng(2));
    if (plan) assert.ok(Math.hypot(plan.stand.x, Math.abs(plan.stand.z) - 1.4) >= 0.85 || Math.abs(plan.stand.x) > 0.85);
  });

describe("Sala dos Agentes: ninguém troca de mesa sozinho", () => {
  const people = (names: string[]) => names.map((n) => ({ id: `id-${n}`, name: n, accent: "#fff" }));
  const seat = (l: ReturnType<typeof computeOfficeLayout>, id: string) => l.desks.find((d) => d.projectId === id)!;

  it("com keepOrder, chegar um agente (mesmo com nome que viria antes na ordem alfabética) não mexe nas mesas dos outros", () => {
    const before = computeOfficeLayout(people(["Zeta", "Mira", "Omega"]), [], { minWidth: 9, keepOrder: true });
    const after = computeOfficeLayout(people(["Zeta", "Mira", "Omega", "Alfa"]), [], { minWidth: 9, keepOrder: true });
    for (const n of ["Zeta", "Mira", "Omega"]) {
      assert.equal(seat(after, `id-${n}`).row, seat(before, `id-${n}`).row);
      assert.equal(seat(after, `id-${n}`).col, seat(before, `id-${n}`).col);
    }
    // sem keepOrder (projetos) segue alfabético: o recém-chegado "Alfa" empurra os outros
    const alpha = computeOfficeLayout(people(["Zeta", "Mira", "Omega", "Alfa"]), []);
    assert.equal(seat(alpha, "id-Alfa").col, 0);
  });

  it("ordem: permanentes primeiro na ordem dada; observados por início, sem depender do último evento", () => {
    const perm = [{ id: "p2", startedAt: "2026-01-01" }, { id: "p1", startedAt: "2026-01-02" }];
    const obs = [{ id: "o2", startedAt: "2026-02-02" }, { id: "o1", startedAt: "2026-02-01" }, { id: "p1", startedAt: "2026-01-02" }];
    assert.deepEqual(orderAgentSessions(perm, obs).map((s) => s.id), ["p2", "p1", "o1", "o2"]);
    assert.deepEqual(orderAgentSessions(perm, [...obs].reverse()).map((s) => s.id), ["p2", "p1", "o1", "o2"], "mesma ordem não importa como chegam");
  });

  it("a cor vem do id, não da posição: outro agente entrando não repinta ninguém", () => {
    const palette = ["#a", "#b", "#c", "#d", "#e", "#f", "#g", "#h"];
    assert.equal(agentAccent("id-Zeta", palette), agentAccent("id-Zeta", palette));
    const set = new Set(["a", "b", "c", "d", "e", "f"].map((x) => agentAccent(`id-${x}`, palette)));
    assert.ok(set.size >= 3, "cores variam entre agentes");
  });
});
});
