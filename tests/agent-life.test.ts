import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeLoungeLayout } from "@/components/universe/hq/life/lounge-layout";
import { buildLifeWorld } from "@/components/universe/hq/life/world";
import { LifeSim, type Actor, type SyncInput } from "@/components/universe/hq/life/sim";
import { dist } from "@/components/universe/hq/life/geometry";
import { agentIsTyping, agentNeedsDesk } from "@/components/universe/hq/life/policy";

const DEPTH = 13;
/** Mesma regra do escritório: a sala cresce com as linhas de mesas (mínimo 13 m para caber o lounge). */
const depthFor = (count: number) => Math.max(DEPTH, 3.3 + Math.ceil(count / 3) * 3 + 3.6);
const AGENTS_MIN = 12;
const AGENTS_MAX = 24.4;

function makeWorld(count: number, mainCount = 0) {
  const mainCols = Math.max(3, Math.round(Math.sqrt(Math.max(mainCount, 1) * 1.8)));
  const depth = Math.max(depthFor(count), mainCount > 0 ? 3.3 + Math.ceil(mainCount / mainCols) * 3 + 3.6 : 0);
  const mainW = Math.max(15, mainCols * 3 + 3.4);
  // Com sala de operações: ela ocupa [-W/2, W/2] e a dos agentes vem logo depois; sem ela, mantém as coordenadas antigas.
  const agentsMin = mainCount > 0 ? mainW / 2 : AGENTS_MIN;
  const agentsMax = agentsMin + (AGENTS_MAX - AGENTS_MIN);
  const doorZ = depth / 2 - 1.9;
  const lounge = computeLoungeLayout(agentsMax, depth, doorZ);
  const cols = 3;
  const agentDesks = Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    x: agentsMin + 3.4 + (i % cols) * 3.0,
    z: -depth / 2 + 3.3 + 1.5 + Math.floor(i / cols) * 3.0,
  }));
  const mainDesks = Array.from({ length: mainCount }, (_, i) => {
    const inRow = Math.floor(i / mainCols) === Math.ceil(mainCount / mainCols) - 1 ? mainCount - Math.floor(i / mainCols) * mainCols : mainCols;
    return { id: `p${i}`, x: ((i % mainCols) - (inRow - 1) / 2) * 3.0, z: -depth / 2 + 3.3 + 1.5 + Math.floor(i / mainCols) * 3.0, halfW: 0.8 };
  });
  const rooms = [
    ...(mainCount > 0 ? [{ minX: -mainW / 2, maxX: mainW / 2 }] : []),
    { minX: agentsMin, maxX: agentsMax },
    { minX: agentsMax, maxX: agentsMax + 13 },
  ];
  return buildLifeWorld({ rooms, doorZ, depth, lounge, desks: [...mainDesks, ...agentDesks], doorWidth: 1.15 });
}

function setup(count: number, mustWork: boolean | ((i: number) => boolean) = false, seed = 7, mainCount = 0) {
  const world = makeWorld(count, mainCount);
  const sim = new LifeSim(seed);
  sim.setWorld(world);
  const inputs = (): SyncInput[] => [
    ...Array.from({ length: mainCount }, (_, i) => ({ id: `p${i}`, seed: i * 17 + 5, mustWork: typeof mustWork === "function" ? mustWork(i) : mustWork, working: typeof mustWork === "function" ? mustWork(i) : mustWork })),
    ...Array.from({ length: count }, (_, i) => ({ id: `a${i}`, seed: i * 31 + 3, mustWork: typeof mustWork === "function" ? mustWork(i) : mustWork, working: typeof mustWork === "function" ? mustWork(i) : mustWork })),
  ];
  sim.sync(inputs());
  return { world, sim, inputs };
}

function run(sim: LifeSim, seconds: number, onStep?: (t: number) => void, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    sim.step(dt);
    onStep?.(t);
  }
}

const get = (sim: LifeSim, id: string): Actor => sim.actors.get(id)!;
const all = (sim: LifeSim) => [...sim.actors.values()];

function setMust(sim: LifeSim, ids: Record<string, boolean>) {
  const inputs: SyncInput[] = all(sim).map((a) => ({ id: a.id, seed: a.seed, mustWork: ids[a.id] ?? a.mustWork, working: ids[a.id] ?? a.working }));
  sim.sync(inputs);
}

/** Roda até alguém chegar a uma fase/atividade (ou estourar o tempo). */
function runUntil(sim: LifeSim, cond: () => boolean, maxSeconds: number): number {
  const dt = 1 / 30;
  for (let t = 0; t < maxSeconds; t += dt) {
    if (cond()) return t;
    sim.step(dt);
  }
  return Infinity;
}

describe("Vida dos agentes — navegação", () => {
  it("todos os destinos (assentos, aproximações, sinuca, conversas, passeio, mesas) estão em chão livre", () => {
    const w = makeWorld(6);
    const lounge = w.lounge;
    const goals = [
      ...lounge.seats.map((s) => ({ n: s.id, p: s.approach })),
      ...lounge.poolSpots.map((s) => ({ n: s.id, p: s.pos })),
      ...lounge.chatPairs.flatMap((c) => [{ n: c.a.id, p: c.a.pos }, { n: c.b.id, p: c.b.pos }]),
      ...lounge.wander.map((p, i) => ({ n: `wander-${i}`, p })),
      ...[...w.desks.values()].map((d) => ({ n: `desk-${d.id}`, p: d.approach })),
    ];
    for (const g of goals) assert.ok(w.grid.isFree(g.p.x, g.p.z), `destino bloqueado: ${g.n} (${g.p.x.toFixed(2)}, ${g.p.z.toFixed(2)})`);
  });

  it("existe caminho de cada mesa a cada destino do lounge, passando pela porta e sem atravessar móveis", () => {
    const w = makeWorld(6);
    const lounge = w.lounge;
    const targets = [...lounge.seats.map((s) => s.approach), ...lounge.poolSpots.map((s) => s.pos), ...lounge.wander];
    for (const desk of w.desks.values()) {
      for (const t of targets) {
        const path = w.grid.findPath(desk.approach, t);
        assert.ok(path && path.length > 0, `sem caminho de ${desk.id} até (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
        let prev = desk.approach;
        for (const p of path!) {
          assert.ok(w.grid.lineOfSight(prev, p), "trecho do caminho atravessa obstáculo");
          prev = p;
        }
        // tem de cruzar a divisória pela porta
        const crossesWall = path!.some((p, i) => {
          const a = i === 0 ? desk.approach : path![i - 1];
          return (a.x - lounge.x0) * (p.x - lounge.x0) < 0;
        });
        assert.ok(crossesWall);
      }
    }
  });

  it("paredes e móveis bloqueiam: não há caminho pela parede nem para dentro de móvel", () => {
    const w = makeWorld(3);
    const inside = { x: w.lounge.furniture.pool.x, z: w.lounge.furniture.pool.z };
    assert.equal(w.grid.isFree(inside.x, inside.z), false);
    assert.equal(w.grid.isFree(AGENTS_MAX, -3), false, "a divisória fora da porta é parede");
    assert.equal(w.grid.isFree(AGENTS_MAX, w.lounge.door.z), true, "o vão da porta é livre");
  });
});

describe("Vida dos agentes — cenários", () => {
  it("1. agente trabalhando recebe tarefa e vai até a mesa (já está lá: só digita)", () => {
    const { sim } = setup(2, false);
    setMust(sim, { a0: true });
    run(sim, 1);
    const a = get(sim, "a0");
    assert.equal(a.phase, "desk");
    assert.equal(a.activity, "working");
    assert.ok(a.vis.work > 0.5, "animação de trabalho ligada");
  });

  it("2. quem está no sofá recebe tarefa, levanta e caminha até a mesa", () => {
    const { sim } = setup(1, false, 3);
    const a = get(sim, "a0");
    assert.ok(runUntil(sim, () => a.phase === "seated" && a.seat?.kind === "sofa" || (a.phase === "seated" && a.seat !== null), 120) < 120, "deveria sentar em algum lugar");
    const seat = a.seat!;
    setMust(sim, { a0: true });
    assert.equal(a.intent.kind, "work");
    run(sim, 0.1);
    assert.equal(a.phase, "rising", "levanta primeiro (não teleporta)");
    const startPos = { x: a.x, z: a.z };
    const t = runUntil(sim, () => a.phase === "desk", 40);
    assert.ok(t < 40, `chegou à mesa em ${t.toFixed(1)}s`);
    assert.ok(dist(a, a.desk.seat) < 0.05);
    assert.ok(dist(startPos, a.desk.seat) > 3, `a mesa estava longe (${seat.id})`);
    assert.equal(sim.occupancy().size, 0, "liberou a reserva");
  });

  it("3. quem joga sinuca interrompe a partida e vai trabalhar", () => {
    // Varre sementes até algum agente ocioso escolher a sinuca (a escolha é aleatória, mas reproduzível por semente).
    let poolReached = false;
    for (let seed = 1; seed < 60 && !poolReached; seed += 1) {
      const s = setup(1, false, seed);
      const b = get(s.sim, "a0");
      const t = runUntil(s.sim, () => b.phase === "standing" && b.intent.kind === "pool" && b.arrived, 90);
      if (t < 90) {
        poolReached = true;
        setMust(s.sim, { a0: true });
        s.sim.step(1 / 30);
        assert.equal(b.intent.kind, "work");
        assert.equal(b.phase, "walking", "sai da partida imediatamente, sem levantar de cadeira");
        assert.equal(runUntil(s.sim, () => b.phase === "desk", 40) < 40, true);
        assert.equal(s.sim.occupancy().size, 0);
        assert.equal(b.vis.cue, false, "largou o taco");
      }
    }
    assert.ok(poolReached, "algum agente chegou a jogar sinuca");
  });

  it("4. quem está no bar (banqueta) recebe tarefa e vai trabalhar", () => {
    let done = false;
    for (let seed = 1; seed < 80 && !done; seed += 1) {
      const { sim } = setup(1, false, seed);
      const a = get(sim, "a0");
      if (runUntil(sim, () => a.phase === "seated" && a.seat?.kind === "stool", 90) >= 90) continue;
      done = true;
      setMust(sim, { a0: true });
      run(sim, 0.2);
      assert.equal(a.phase, "rising");
      assert.ok(runUntil(sim, () => a.phase === "desk", 40) < 40);
    }
    assert.ok(done, "algum agente chegou a sentar no bar");
  });

  it("5. ao terminar a tarefa, vai para o lounge e escolhe uma atividade", () => {
    const { sim } = setup(1, true);
    const a = get(sim, "a0");
    run(sim, 1);
    assert.equal(a.phase, "desk");
    setMust(sim, { a0: false });
    const t = runUntil(sim, () => a.phase === "seated" || (a.phase === "standing" && a.arrived), 60);
    assert.ok(t < 60, "chegou a uma atividade");
    assert.ok(a.x > AGENTS_MAX, "está na sala de convivência (além da divisória)");
    assert.notEqual(a.activity, "working");
  });

  it("6. vários agentes ociosos escolhem atividades diferentes", () => {
    const { sim } = setup(8, false, 5);
    const seen = new Set<string>();
    run(sim, 240, () => {
      for (const a of all(sim)) if (a.phase === "seated" || a.phase === "standing") seen.add(a.activity);
    });
    assert.ok(seen.size >= 3, `atividades vistas: ${[...seen].join(", ")}`);
    // num instante qualquer, ninguém repete o mesmo lugar
    const kinds = new Set(all(sim).map((a) => a.activity));
    assert.ok(kinds.size >= 2 || all(sim).some((a) => a.phase === "walking"));
  });

  it("7/8. muitos agentes disputam os mesmos lugares: sem ocupação duplicada nem sobreposição", () => {
    const { sim, world } = setup(12, false, 21);
    let minPair = Infinity;
    const closeCalls: string[] = [];
    const keyHolders = new Map<string, string>();
    run(sim, 300, () => {
      const seats = new Map<string, string>();
      for (const a of all(sim)) {
        if (a.phase === "seated" && a.seat) {
          assert.ok(!seats.has(a.seat.id), `${a.seat.id} ocupado por dois: ${seats.get(a.seat.id)} e ${a.id}`);
          seats.set(a.seat.id, a.id);
        }
        if (a.phase === "standing" && a.arrived && (a.intent.kind === "pool" || a.intent.kind === "chat")) {
          const key = a.intent.kind === "pool" ? a.intent.spot.id : `${a.intent.pair.id}-${a.intent.side}`;
          if (keyHolders.get(key) && keyHolders.get(key) !== a.id) {
            const other = get(sim, keyHolders.get(key)!);
            assert.ok(!(other.phase === "standing" && other.arrived && dist(other, a) < 0.2), `lugar ${key} duplicado`);
          }
          keyHolders.set(key, a.id);
        }
      }
      const list = all(sim);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          // Só mede quem não está na mesa de trabalho original (as mesas são distintas por construção).
          const d = dist(list[i], list[j]);
          if (d < minPair) minPair = d;
        }
      }
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          if (dist(list[i], list[j]) < 0.3) closeCalls.push(`${list[i].id}(${list[i].phase},${list[i].intent.kind}) x ${list[j].id}(${list[j].phase},${list[j].intent.kind}) d=${dist(list[i], list[j]).toFixed(2)} at (${list[i].x.toFixed(1)},${list[i].z.toFixed(1)})`);
        }
      }
      for (const a of list) {
        if (a.phase === "walking") assert.equal(world.grid.isSolid(a.x, a.z), false, `${a.id} atravessou móvel/parede em (${a.x.toFixed(2)}, ${a.z.toFixed(2)})`);
      }
    });
    assert.ok(minPair > 0.3, `distância mínima entre dois personagens: ${minPair.toFixed(2)} m — ${closeCalls.slice(0, 4).join(" | ")}`);
    assert.equal(all(sim).reduce((n, a) => n + a.recoveries, 0), 0, "nenhuma recuperação de emergência (teleporte) foi necessária");
  });

  it("9. agente offline (sessão encerrada) desaparece e libera tudo", () => {
    const { sim } = setup(3, false, 9);
    run(sim, 40);
    sim.sync([{ id: "a0", seed: 1, mustWork: false, working: false }]);
    assert.equal(sim.actors.size, 1);
    for (const key of sim.occupancy().keys()) assert.equal(sim.occupancy().get(key), "a0");
  });

  it("10. nova tarefa interrompe qualquer atividade, em qualquer ponto do deslocamento", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { sim } = setup(4, false, seed);
      run(sim, 15 + seed * 3);
      const ids = all(sim).map((a) => a.id);
      const busy = Object.fromEntries(ids.map((id) => [id, true]));
      setMust(sim, busy);
      for (const a of all(sim)) assert.equal(a.intent.kind, "work");
      const t = runUntil(sim, () => all(sim).every((a) => a.phase === "desk"), 60);
      assert.ok(t < 60, `seed ${seed}: todos na mesa em ${t.toFixed(1)}s`);
      assert.equal(sim.occupancy().size, 0, `seed ${seed}: reservas liberadas`);
    }
  });

  it("não há teleporte: o deslocamento por quadro respeita a velocidade de caminhada", () => {
    const { sim } = setup(6, false, 13);
    const last = new Map<string, { x: number; z: number }>();
    let worst = 0;
    const dt = 1 / 30;
    run(sim, 300, () => {
      for (const a of all(sim)) {
        const p = last.get(a.id);
        if (p) worst = Math.max(worst, dist(p, a) / dt);
        last.set(a.id, { x: a.x, z: a.z });
      }
    }, dt);
    assert.ok(worst < 2.6, `velocidade máxima observada: ${worst.toFixed(2)} m/s`);
  });

  it("ninguém caminha para sempre: toda caminhada termina em atividade", () => {
    const { sim } = setup(5, false, 17);
    const walkingSince = new Map<string, number>();
    let longest = 0;
    run(sim, 400, (t) => {
      for (const a of all(sim)) {
        if (a.phase === "walking") {
          const since = walkingSince.get(a.id) ?? t;
          walkingSince.set(a.id, since);
          longest = Math.max(longest, t - since);
        } else walkingSince.delete(a.id);
      }
    });
    assert.ok(longest < 35, `caminhada mais longa: ${longest.toFixed(1)}s`);
  });

  it("não altera o estado real: a simulação só lê mustWork/working", () => {
    const { sim } = setup(3, (i) => i === 0, 2);
    run(sim, 60);
    assert.equal(get(sim, "a0").mustWork, true);
    assert.equal(get(sim, "a1").mustWork, false);
  });

  it("o estado real decide quem precisa da mesa: só ocioso é livre; erro e aprovação ficam na mesa mas não digitam", () => {
    assert.equal(agentNeedsDesk("WORKING"), true);
    assert.equal(agentNeedsDesk("APPROVAL"), true);
    assert.equal(agentNeedsDesk("ERROR"), true);
    assert.equal(agentNeedsDesk("IDLE"), false);
    assert.equal(agentIsTyping("WORKING"), true);
    assert.equal(agentIsTyping("ERROR"), false);
    assert.equal(agentIsTyping("APPROVAL"), false);
  });

  it("funcionários dos projetos (sala de operações) também chegam ao lounge e voltam à mesa", () => {
    const { sim, world } = setup(0, false, 3, 12);
    const first = get(sim, "p0");
    // alguém de cada ponta da sala chega a uma atividade no lounge (atravessa duas portas)
    const far = get(sim, "p5");
    assert.ok(runUntil(sim, () => (first.phase === "seated" || (first.phase === "standing" && first.arrived)) && first.x > world.lounge.x0, 240) < 240, "p0 chegou ao lounge");
    assert.ok(runUntil(sim, () => (far.phase === "seated" || (far.phase === "standing" && far.arrived)) && far.x > world.lounge.x0, 240) < 240, "p5 chegou ao lounge");
    // chega deploy real em quem está no lounge: volta à mesa
    sim.sync([...sim.actors.values()].map((a) => ({ id: a.id, seed: a.seed, mustWork: a.id === "p0" || a.mustWork, working: a.id === "p0" || a.working })));
    assert.ok(runUntil(sim, () => first.phase === "desk", 90) < 90, "p0 voltou à mesa");
    assert.equal(sim.occupancy().get(first.reservation ?? "") ?? first.id, first.id);
  });

  it("17 projetos + agentes ociosos: lounge lotado não trava ninguém nem duplica lugar", () => {
    const { sim } = setup(5, false, 9, 17);
    let minPair = Infinity;
    run(sim, 360, () => {
      const seats = new Map<string, string>();
      for (const a of all(sim)) if (a.phase === "seated" && a.seat) {
        assert.ok(!seats.has(a.seat.id), `${a.seat.id} duplicado`);
        seats.set(a.seat.id, a.id);
      }
      const l = all(sim);
      for (let i = 0; i < l.length; i += 1) for (let j = i + 1; j < l.length; j += 1) minPair = Math.min(minPair, dist(l[i], l[j]));
    });
    assert.ok(minPair > 0.25, `distância mínima ${minPair.toFixed(2)} m`);
    assert.equal(all(sim).reduce((n, a) => n + a.recoveries, 0), 0, "sem teleporte de emergência");
    const inLounge = all(sim).filter((a) => a.phase !== "desk").length;
    assert.ok(inLounge >= 5, `pelo menos 5 fora das mesas (${inLounge})`);
  });

  it("agente com erro/aprovação não aparece trabalhando: fica na mesa sem animação de digitar", () => {
    const { sim } = setup(1, false, 4);
    const a = get(sim, "a0");
    sim.sync([{ id: "a0", seed: a.seed, mustWork: true, working: false }]);
    run(sim, 30);
    assert.equal(a.phase, "desk");
    assert.ok(a.vis.work < 0.05, "sem animação de digitar");
  });
});
