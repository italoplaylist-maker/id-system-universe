import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LifeSim, type Actor, type SyncInput } from "@/components/universe/hq/life/sim";
import { dist } from "@/components/universe/hq/life/geometry";
import { agentIsTyping, agentNeedsDesk, deskChairAway } from "@/components/universe/hq/life/policy";
import { HQ } from "@/components/universe/hq/plan/hq-plan";
import { hqFixture } from "./hq-fixture";

type Fixture = ReturnType<typeof hqFixture>;

function setup(nProjects: number, nAgents: number, nClt: number, mustWork: (id: string) => boolean = () => false, seed = 7, instant = false) {
  const fx = hqFixture(nProjects, nAgents, nClt);
  const sim = new LifeSim(seed);
  sim.setWorld(fx.world);
  const ids = [...fx.projects, ...fx.agents, ...fx.clt].map((x) => x.id);
  const inputs = (): SyncInput[] => ids.map((id, i) => ({ id, seed: i * 31 + 3, mustWork: mustWork(id), working: mustWork(id) }));
  sim.sync(inputs(), { instant });
  return { fx, sim, ids, inputs };
}

function run(sim: LifeSim, seconds: number, onStep?: (t: number) => void, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    sim.step(dt);
    onStep?.(t);
  }
}

/** Roda até a condição valer (ou estourar o tempo); devolve os segundos gastos. */
function runUntil(sim: LifeSim, cond: () => boolean, maxSeconds: number): number {
  const dt = 1 / 30;
  for (let t = 0; t < maxSeconds; t += dt) {
    if (cond()) return t;
    sim.step(dt);
  }
  return Infinity;
}

const get = (sim: LifeSim, id: string): Actor => sim.actors.get(id)!;
const all = (sim: LifeSim) => [...sim.actors.values()];
const inAtrium = (a: { x: number; z: number }) => Math.hypot(a.x, a.z) < HQ.ATRIUM_RADIUS;

function setMust(sim: LifeSim, change: Record<string, boolean>) {
  sim.sync(all(sim).map((a) => ({ id: a.id, seed: a.seed, mustWork: change[a.id] ?? a.mustWork, working: change[a.id] ?? a.working })));
}

describe("Vida dos agentes — navegação", () => {
  it("todos os pontos de passeio e aproximações de mesa estão em chão livre", () => {
    const { fx } = setup(3, 4, 7);
    for (const p of fx.world.wander) assert.ok(fx.world.grid.isFree(p.x, p.z), `ponto de passeio bloqueado (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    for (const d of fx.world.desks.values()) assert.ok(fx.world.grid.isFree(d.approach.x, d.approach.z), `aproximação de ${d.id} bloqueada`);
  });

  it("existe caminho de cada mesa (inclusive da sala CLT) a cada ponto de passeio, sem atravessar móvel", () => {
    const { fx } = setup(3, 4, 7);
    for (const desk of fx.world.desks.values()) {
      for (const t of fx.world.wander) {
        const path = fx.world.grid.findPath(desk.approach, t);
        assert.ok(path && path.length > 0, `sem caminho de ${desk.id} até (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
        let prev = desk.approach;
        for (const p of path!) {
          assert.ok(fx.world.grid.lineOfSight(prev, p), "trecho do caminho atravessa obstáculo");
          prev = p;
        }
      }
    }
  });

  it("paredes e móveis bloqueiam: o núcleo do átrio e a mesa de supervisão da sala CLT não são caminháveis", () => {
    const { fx } = setup(3, 3, 7);
    assert.equal(fx.world.grid.isFree(0, 0), false, "o núcleo do átrio é obstáculo");
    const c = fx.plan.wings.clt;
    const w = (x: number, z: number) => {
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      return { x: c.x + x * cos + z * sin, z: c.z - x * sin + z * cos };
    };
    const table = w(fx.cltLayout.table.x, fx.cltLayout.table.z);
    assert.equal(fx.world.grid.isFree(table.x, table.z), false, "a mesa de supervisão é obstáculo");
    const meeting = w(fx.cltLayout.meeting.x, fx.cltLayout.meeting.z);
    assert.equal(fx.world.grid.isFree(meeting.x, meeting.z), false, "a sala de reunião é obstáculo");
  });
});

describe("Vida dos agentes — cenários", () => {
  it("1. agente com trabalho fica na mesa e só digita quando está executando", () => {
    const { sim } = setup(0, 2, 0, (id) => id === "a0");
    run(sim, 30);
    const a = get(sim, "a0");
    assert.equal(a.phase, "desk");
    assert.equal(a.activity, "working");
    assert.ok(a.vis.work > 0.5, "animação de trabalho ligada");
    assert.ok(dist(a, a.desk.seat) < 0.05);
  });

  it("2. aguardando aprovação (precisa da mesa, mas não digita): na mesa, sem animação de trabalho", () => {
    const fx = hqFixture(0, 1, 0);
    const sim = new LifeSim(5);
    sim.setWorld(fx.world);
    sim.sync([{ id: "a0", seed: 1, mustWork: true, working: false }]);
    run(sim, 20);
    const a = get(sim, "a0");
    assert.equal(a.phase, "desk");
    assert.ok(a.vis.work < 0.05, "não finge que digita");
  });

  it("3. ocioso descansa na mesa, depois levanta e passeia pelo átrio (um ponto só para ele)", () => {
    const { sim } = setup(0, 1, 0, () => false, 3);
    const a = get(sim, "a0");
    const t = runUntil(sim, () => a.phase === "standing" && a.arrived, 120);
    assert.ok(t < 120, "deveria chegar a um ponto do átrio");
    assert.ok(inAtrium(a), `parou fora do átrio (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
    assert.equal(a.intent.kind, "wander");
    assert.equal(sim.occupancy().size, 1, "reservou o ponto");
  });

  it("4. quem passeia recebe tarefa, para e caminha até a mesa", () => {
    const { sim } = setup(0, 1, 0, () => false, 3);
    const a = get(sim, "a0");
    assert.ok(runUntil(sim, () => a.phase === "standing" && a.arrived, 120) < 120);
    setMust(sim, { a0: true });
    assert.equal(a.intent.kind, "work");
    const t = runUntil(sim, () => a.phase === "desk", 60);
    assert.ok(t < 60, `chegou à mesa em ${t.toFixed(1)}s`);
    assert.ok(dist(a, a.desk.seat) < 0.05);
    assert.equal(sim.occupancy().size, 0, "liberou a reserva do ponto");
  });

  it("5. o estado inicial já posiciona cada um: ocioso no átrio, com trabalho na mesa", () => {
    const { sim } = setup(0, 4, 0, (id) => id === "a0" || id === "a1", 11, true);
    for (const id of ["a0", "a1"]) {
      assert.equal(get(sim, id).phase, "desk", `${id} trabalhando deveria estar na mesa`);
      assert.equal(get(sim, id).activity, "working");
    }
    for (const id of ["a2", "a3"]) {
      const a = get(sim, id);
      assert.equal(a.phase, "standing", `${id} ocioso deveria já estar passeando`);
      assert.ok(inAtrium(a));
    }
    const spots = ["a2", "a3"].map((id) => get(sim, id));
    assert.ok(dist(spots[0], spots[1]) > 0.8, "dois ociosos não nascem no mesmo ponto");
  });

  it("6. a sala AGENTES CLT funciona como as outras: agente ocioso sai pela porta, passeia e volta", () => {
    const { sim, fx } = setup(0, 0, 3, () => false, 9);
    const a = get(sim, "c0");
    const clt = fx.plan.wings.clt;
    const insideClt = (p: { x: number; z: number }) => dist(p, { x: clt.x, z: clt.z }) < Math.min(clt.width, clt.depth) / 2;
    assert.ok(insideClt(a), "começa dentro da sala CLT");
    assert.ok(runUntil(sim, () => a.phase === "standing" && a.arrived && inAtrium(a), 150) < 150, "chega ao átrio");
    setMust(sim, { c0: true });
    assert.ok(runUntil(sim, () => a.phase === "desk", 80) < 80, "volta à estação");
    assert.ok(insideClt(a), "e senta dentro da sala CLT");
  });

  it("7. muita gente ociosa: ninguém divide ponto do átrio, ninguém se sobrepõe e ninguém trava", () => {
    const { sim } = setup(8, 14, 14, () => false, 21);
    let worstOverlap = Infinity;
    run(sim, 360, (t) => {
      if (Math.round(t * 30) % 15 !== 0) return;
      const keys = [...sim.occupancy().values()];
      assert.equal(new Set(keys).size, keys.length, "um personagem por ponto reservado");
      const list = all(sim);
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) worstOverlap = Math.min(worstOverlap, dist(list[i], list[j]));
    });
    assert.ok(worstOverlap > 0.12, `dois personagens quase no mesmo lugar (${worstOverlap.toFixed(2)} m)`);
    for (const a of all(sim)) assert.ok(a.recoveries <= 3, `${a.id} precisou de ${a.recoveries} recuperações de travamento`);
    // ninguém ficou fora de chão livre
    const free = all(sim).every((a) => a.phase === "desk" || a.phase === "sitting" || a.phase === "rising" || sim.levelAt(a.x, a.z) >= 0);
    assert.ok(free);
  });

  it("8. oscilar entre ocioso e trabalhando várias vezes termina sempre na mesa, sem reservas sobrando", () => {
    const { sim } = setup(0, 3, 0, () => false, 4);
    for (let round = 0; round < 6; round += 1) {
      run(sim, 25);
      setMust(sim, { a0: true, a1: true, a2: true });
      run(sim, 40);
      for (const a of all(sim)) assert.equal(a.phase, "desk", `${a.id} deveria estar na mesa`);
      assert.equal(sim.occupancy().size, 0);
      setMust(sim, { a0: false, a1: false, a2: false });
    }
  });

  it("9. agente que sai da lista (offline) some e libera o ponto que reservou", () => {
    const { sim } = setup(0, 2, 0, () => false, 6);
    const a = get(sim, "a0");
    assert.ok(runUntil(sim, () => a.phase === "walking" || a.phase === "standing", 120) < 120);
    sim.sync([{ id: "a1", seed: 3, mustWork: false, working: false }]);
    assert.equal(sim.actors.has("a0"), false);
    assert.ok([...sim.occupancy().values()].every((id) => id !== "a0"));
  });

  it("10. a simulação é determinística para a mesma semente", () => {
    const trace = () => {
      const { sim } = setup(2, 3, 3, () => false, 99);
      run(sim, 90);
      return all(sim).map((a) => `${a.id}:${a.x.toFixed(3)},${a.z.toFixed(3)},${a.phase}`).join("|");
    };
    assert.equal(trace(), trace());
  });
});

describe("Vida dos agentes — política", () => {
  it("só trabalhando, aguardando aprovação ou com erro precisa da mesa; só trabalhando digita", () => {
    assert.equal(agentNeedsDesk("WORKING"), true);
    assert.equal(agentNeedsDesk("APPROVAL"), true);
    assert.equal(agentNeedsDesk("ERROR"), true);
    assert.equal(agentNeedsDesk("IDLE"), false);
    assert.equal(agentIsTyping("WORKING"), true);
    assert.equal(agentIsTyping("APPROVAL"), false);
  });

  it("a cadeira acompanha o personagem: sob a mesa quando sentado, puxada quando ele saiu", () => {
    assert.equal(deskChairAway(undefined), 0);
    const { sim } = setup(0, 1, 0, () => false, 3);
    const a = get(sim, "a0");
    assert.equal(deskChairAway(a), 0);
    assert.ok(runUntil(sim, () => a.phase === "walking", 120) < 120);
    assert.equal(deskChairAway(a), 1);
  });
});

// o tipo é usado só para documentar a forma do fixture nos cenários acima
export type { Fixture };
