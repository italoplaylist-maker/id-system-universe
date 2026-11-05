import { NavGrid } from "./nav-grid";
import { obstacleToWorld, rectObstacle, toWorld, type Obstacle, type Vec2 } from "./geometry";
import { HQ, type HqPlan, type WingId } from "../plan/hq-plan";
import type { LoungeLayout } from "./lounge-layout";

export interface DeskInfo {
  id: string;
  /** Onde o quadril do agente fica sentado. */
  seat: Vec2;
  yaw: number;
  /** Ponto livre atrás da cadeira, de onde ele senta/levanta. */
  approach: Vec2;
}

export interface LifeWorldInput {
  /** Interior de cada sala, lado a lado (operações · agentes · lounge). As divisórias ficam nos limites entre elas. */
  rooms: Array<{ minX: number; maxX: number }>;
  /** z da porta de cada divisória (mesma para todas). */
  doorZ: number;
  depth: number;
  lounge: LoungeLayout;
  /** Mesas (assentos já em coordenadas mundiais). `halfW` = meia largura do tampo (varia com o nº de monitores). */
  desks: Array<{ id: string; x: number; z: number; halfW?: number }>;
  doorWidth: number;
  extraObstacles?: Obstacle[];
}

export interface LifeWorld {
  grid: NavGrid;
  lounge: LoungeLayout;
  desks: Map<string, DeskInfo>;
  /** Muda sempre que a geometria muda — a simulação usa para saber que precisa replanejar. */
  signature: string;
  /** Altura do piso em (x, z): átrio, rampas e alas têm níveis diferentes. */
  levelAt: (x: number, z: number) => number;
}

export const BODY_RADIUS = 0.28;
const DESK_HALF_W = 0.8;
const DESK_HALF_D = 0.46;
/** Centro do tampo em relação ao assento, no sentido do fundo da sala (-z no mundo). */
const DESK_FORWARD = 0.84;
const APPROACH_BACK = 0.95;

export function worldSignature(input: LifeWorldInput): string {
  return [
    ...input.rooms.map((r) => `${r.minX.toFixed(2)}:${r.maxX.toFixed(2)}`),
    input.depth.toFixed(2),
    input.doorZ.toFixed(2),
    input.doorWidth.toFixed(2),
    input.lounge.x0.toFixed(2),
    ...input.desks.map((d) => `${d.id}@${d.x.toFixed(2)},${d.z.toFixed(2)},${(d.halfW ?? DESK_HALF_W).toFixed(2)}`),
    String((input.extraObstacles ?? []).length),
  ].join("|");
}

/**
 * Monta a malha de navegação do mundo da vida dos agentes: sala dos agentes + lounge, ligadas
 * pela porta. Paredes são o que sobra fora do chão caminhável; móveis entram como obstáculos.
 */
export function buildLifeWorld(input: LifeWorldInput): LifeWorld {
  const { rooms, lounge, depth, desks, doorWidth, doorZ } = input;
  const minZ = -depth / 2;
  const maxZ = depth / 2;
  const first = rooms[0];
  const last = rooms[rooms.length - 1];
  // Salas grandes (muitos projetos) usam células maiores para o A* continuar barato.
  const span = last.maxX - first.minX;
  const grid = new NavGrid({ minX: first.minX - 0.5, maxX: last.maxX + 0.5, minZ: minZ - 0.5, maxZ: maxZ + 0.5 }, span > 34 ? 0.2 : 0.15);

  // Chão caminhável: dentro das paredes, com folga; a frente é aberta mas ninguém sai por ela.
  // Cada divisória tem 0,3 m de "espessura" na malha (2 células) — nunca some por alinhamento.
  const zA = minZ + 0.2;
  const zB = maxZ - 0.35;
  rooms.forEach((r, i) => {
    grid.setRect(r.minX + (i === 0 ? 0.15 : 0.15), r.maxX - (i === rooms.length - 1 ? 0.2 : 0.15), zA, zB, false);
    // Vão da porta na divisória à direita desta sala.
    if (i < rooms.length - 1) grid.setRect(r.maxX - 0.2, r.maxX + 0.2, doorZ - doorWidth / 2, doorZ + doorWidth / 2, false);
  });

  const deskInfo = new Map<string, DeskInfo>();
  for (const d of desks) {
    grid.setObstacle(rectObstacle(d.x, d.z - DESK_FORWARD, d.halfW ?? DESK_HALF_W, DESK_HALF_D, "desk"));
    deskInfo.set(d.id, { id: d.id, seat: { x: d.x, z: d.z }, yaw: Math.PI, approach: { x: d.x, z: d.z + APPROACH_BACK } });
  }
  for (const o of lounge.obstacles) grid.setObstacle(o);
  for (const o of input.extraObstacles ?? []) grid.setObstacle(o);
  grid.finalize(BODY_RADIUS);

  return { grid, lounge, desks: deskInfo, signature: worldSignature(input), levelAt: () => 0 };
}

export interface PlanWorldInput {
  plan: HqPlan;
  /** Mesas de projeto da Ala Tecnológica, em coordenadas LOCAIS da ala. */
  techDesks: Array<{ id: string; x: number; z: number; halfW?: number }>;
  techObstacles: Obstacle[];
  /** Mesas dos agentes (Ala Operacional), locais; `yaw` = giro extra da mesa. */
  agentDesks: Array<{ id: string; x: number; z: number; yaw: number }>;
  agentObstacles: Obstacle[];
  lounge: LoungeLayout;
  /** Móveis do átrio, já em coordenadas de mundo. */
  atriumObstacles: Obstacle[];
}

const AREA_INSET = { back: 0.2, side: 0.2, east: 0.15, front: 0.35 };

/**
 * Mundo da simulação para a planta em Y: o chão caminhável é a união do átrio (polígono), das três alas
 * (retângulos girados) e das portas; mesas e móveis das alas giradas entram como obstáculos orientados.
 */
export function buildLifeWorldFromPlan(input: PlanWorldInput): LifeWorld {
  const { plan, lounge } = input;
  const b = plan.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const grid = new NavGrid({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }, span > 34 ? 0.2 : 0.15);

  // Átrio: polígono levemente encolhido (a borda é guarda-corpo/parede).
  grid.setPolygon(plan.atrium.polygon.map((p) => ({ x: p.x * 0.97, z: p.z * 0.97 })), false);

  const carveWing = (id: WingId) => {
    const w = plan.wings[id];
    if (id === "lounge") {
      grid.setRect(lounge.x0 + AREA_INSET.east, lounge.x0 + lounge.width - AREA_INSET.side, lounge.minZ + AREA_INSET.back, lounge.maxZ - AREA_INSET.front, false);
    } else {
      const x0 = -w.width / 2 + AREA_INSET.side;
      const x1 = w.width / 2 - AREA_INSET.east;
      const z0 = -w.depth / 2 + AREA_INSET.back;
      const z1 = w.depth / 2 - AREA_INSET.front;
      const c = toWorld(w, { x: (x0 + x1) / 2, z: (z0 + z1) / 2 });
      grid.setOrect({ cx: c.x, cz: c.z, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, rot: w.rot }, false);
    }
    // Vão da porta atravessando a parede.
    const rot = id === "lounge" ? 0 : w.rot;
    grid.setOrect({ cx: w.door.x + w.u.x * 0.1, cz: w.door.z + w.u.z * 0.1, hx: 0.75, hz: HQ.DOOR_WIDTH / 2 - 0.1, rot }, false);
  };
  carveWing("tech");
  carveWing("agents");
  carveWing("lounge");

  const desks = new Map<string, DeskInfo>();
  const tech = plan.wings.tech;
  for (const d of input.techDesks) {
    // mesa de projeto: assento voltado para −z local (yaw π), como na sala original
    const seat = toWorld(tech, { x: d.x, z: d.z });
    const centre = toWorld(tech, { x: d.x, z: d.z - DESK_FORWARD });
    grid.setObstacle({ kind: "orect", cx: centre.x, cz: centre.z, hx: d.halfW ?? DESK_HALF_W, hz: DESK_HALF_D, rot: tech.rot, label: "desk" });
    const approach = toWorld(tech, { x: d.x, z: d.z + APPROACH_BACK });
    desks.set(d.id, { id: d.id, seat, yaw: Math.PI + tech.rot, approach });
  }
  const ag = plan.wings.agents;
  for (const d of input.agentDesks) {
    const psi = d.yaw + ag.rot; // giro total da mesa em torno do assento
    const seat = toWorld(ag, { x: d.x, z: d.z });
    const c = Math.cos(psi);
    const sn = Math.sin(psi);
    // R(psi)·(0, −DESK_FORWARD) e R(psi)·(0, +APPROACH_BACK)
    const centre = { x: seat.x + -DESK_FORWARD * sn, z: seat.z + -DESK_FORWARD * c };
    const approach = { x: seat.x + APPROACH_BACK * sn, z: seat.z + APPROACH_BACK * c };
    grid.setObstacle({ kind: "orect", cx: centre.x, cz: centre.z, hx: DESK_HALF_W, hz: DESK_HALF_D, rot: psi, label: "desk" });
    desks.set(d.id, { id: d.id, seat, yaw: Math.PI + psi, approach });
  }
  for (const o of input.techObstacles) grid.setObstacle(obstacleToWorld(tech, o));
  for (const o of input.agentObstacles) grid.setObstacle(obstacleToWorld(ag, o));
  for (const o of lounge.obstacles) grid.setObstacle(o);
  for (const o of input.atriumObstacles) grid.setObstacle(o);
  grid.finalize(BODY_RADIUS);

  const signature = [
    plan.bounds.minX.toFixed(2),
    plan.bounds.maxX.toFixed(2),
    plan.bounds.minZ.toFixed(2),
    plan.bounds.maxZ.toFixed(2),
    ...Object.values(plan.wings).map((w) => `${w.id}:${w.x.toFixed(2)},${w.z.toFixed(2)},${w.rot.toFixed(3)},${w.width.toFixed(2)},${w.depth.toFixed(2)}`),
    lounge.x0.toFixed(2),
    ...[...desks.values()].map((d) => `${d.id}@${d.seat.x.toFixed(2)},${d.seat.z.toFixed(2)},${d.yaw.toFixed(2)}`),
    String(input.techObstacles.length + input.agentObstacles.length + input.atriumObstacles.length),
  ].join("|");
  return { grid, lounge, desks, signature, levelAt: plan.levelAt };
}
