import { NavGrid } from "./nav-grid";
import { rectObstacle, type Obstacle, type Vec2 } from "./geometry";
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

  return { grid, lounge, desks: deskInfo, signature: worldSignature(input) };
}
