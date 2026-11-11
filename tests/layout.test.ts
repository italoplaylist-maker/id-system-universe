import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentAccent, orderAgentSessions } from "@/lib/agent-order";
import { computeOfficeLayout, OFFICE } from "@/components/universe/hq/office/office-layout";
import { CLT_DX, CLT_MAX_STATIONS, CLT_ROOM, computeCltLayout } from "@/components/universe/hq/plan/clt-layout";

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
});

describe("sala AGENTES CLT", () => {
  it("estações em ferradura: dentro da sala, longe uma da outra e da mesa de supervisão, voltadas para ela", () => {
    for (const n of [1, 7, CLT_MAX_STATIONS]) {
      const l = computeCltLayout(n);
      assert.equal(l.stations.length, n);
      for (const s of l.stations) {
        // assento e ponto de aproximação (0,95 m atrás da cadeira) cabem dentro das paredes
        const back = { x: s.x + 0.95 * Math.sin(s.yaw), z: s.z + 0.95 * Math.cos(s.yaw) };
        for (const p of [s, back]) {
          assert.ok(Math.abs(p.x) < CLT_ROOM.width / 2 - 0.3 && Math.abs(p.z) < CLT_ROOM.depth / 2 - 0.4, `estação ${s.index} fora da sala (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
        }
        // a mesa fica à frente do assento, apontando para o centro: a distância à mesa de supervisão diminui
        const ahead = { x: s.x - 0.84 * Math.sin(s.yaw), z: s.z - 0.84 * Math.cos(s.yaw) };
        assert.ok(Math.hypot(ahead.x - l.table.x, ahead.z - l.table.z) < Math.hypot(s.x - l.table.x, s.z - l.table.z), `estação ${s.index} não olha para a mesa de supervisão`);
      }
      for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
        assert.ok(Math.hypot(l.stations[i].x - l.stations[j].x, l.stations[i].z - l.stations[j].z) > 1.9, `estações ${i} e ${j} coladas`);
      }
    }
  });

  it("não é uma fila reta, o ID Manager (estação 0) fica no meio do arco e o corredor da porta fica livre", () => {
    const l = computeCltLayout(7);
    const zs = l.stations.map((s) => s.z);
    const xs = l.stations.map((s) => s.x);
    assert.ok(Math.max(...zs) - Math.min(...zs) > 4 && Math.max(...xs) - Math.min(...xs) > 2, "estações deveriam formar um arco, não uma linha");
    const mid = l.stations[0];
    // ângulo de cada estação em relação ao gerente, já normalizado para (−π, π] (o arco cruza a volta de 360°)
    const delta = (st: { x: number; z: number }) => {
      const d = Math.atan2(st.z - l.table.z, st.x - l.table.x) - Math.atan2(mid.z - l.table.z, mid.x - l.table.x);
      return Math.atan2(Math.sin(d), Math.cos(d));
    };
    const others = l.stations.slice(1, 7).map(delta);
    assert.ok(others.filter((a) => a < 0).length === 3 && others.filter((a) => a > 0).length === 3, "três de cada lado do gerente");
    // corredor da porta (x > 2,5, |z| < 1,2) sem estação, sala de reunião, descanso nem mesa
    for (const s of l.stations) assert.ok(!(s.x - CLT_DX > 2.5 && Math.abs(s.z) < 1.2));
    for (const room of [l.meeting, l.rest]) assert.ok(room.z - room.d / 2 > 1.2 || room.z + room.d / 2 < -1.2, "sala bloqueia o corredor da porta");
  });

  it("limita o número de estações e ignora valores inválidos", () => {
    assert.equal(computeCltLayout(99).stations.length, CLT_MAX_STATIONS);
    assert.equal(computeCltLayout(-3).stations.length, 0);
  });
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
