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
  /** Interior da sala dos agentes (x mundial). */
  agentsRoom: { minX: number; maxX: number };
  depth: number;
  lounge: LoungeLayout;
  /** Assentos das mesas (já em coordenadas mundiais). */
  desks: Array<{ id: string; x: number; z: number }>;
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
  const l = input.lounge;
  return [
    input.agentsRoom.minX.toFixed(2),
    input.agentsRoom.maxX.toFixed(2),
    input.depth.toFixed(2),
    l.x0.toFixed(2),
    input.doorWidth.toFixed(2),
    ...input.desks.map((d) => `${d.id}@${d.x.toFixed(2)},${d.z.toFixed(2)}`),
  ].join("|");
}

/**
 * Monta a malha de navegação do mundo da vida dos agentes: sala dos agentes + lounge, ligadas
 * pela porta. Paredes são o que sobra fora do chão caminhável; móveis entram como obstáculos.
 */
export function buildLifeWorld(input: LifeWorldInput): LifeWorld {
  const { agentsRoom, lounge, depth, desks, doorWidth } = input;
  const minZ = -depth / 2;
  const maxZ = depth / 2;
  const grid = new NavGrid({ minX: agentsRoom.minX - 0.5, maxX: lounge.x0 + lounge.width + 0.5, minZ: minZ - 0.5, maxZ: maxZ + 0.5 }, 0.15);

  // Chão caminhável: dentro das paredes, com folga; a frente é aberta mas ninguém sai por ela.
  const zA = minZ + 0.2;
  const zB = maxZ - 0.35;
  // A divisória tem 0,3 m de "espessura" na malha (2 células) — nunca some por alinhamento.
  grid.setRect(agentsRoom.minX + 0.15, lounge.x0 - 0.15, zA, zB, false);
  grid.setRect(lounge.x0 + 0.15, lounge.x0 + lounge.width - 0.2, zA, zB, false);
  // Vão da porta na divisória.
  grid.setRect(lounge.x0 - 0.2, lounge.x0 + 0.2, lounge.door.z - doorWidth / 2, lounge.door.z + doorWidth / 2, false);

  const deskInfo = new Map<string, DeskInfo>();
  for (const d of desks) {
    grid.setObstacle(rectObstacle(d.x, d.z - DESK_FORWARD, DESK_HALF_W, DESK_HALF_D, "desk"));
    deskInfo.set(d.id, { id: d.id, seat: { x: d.x, z: d.z }, yaw: Math.PI, approach: { x: d.x, z: d.z + APPROACH_BACK } });
  }
  for (const o of lounge.obstacles) grid.setObstacle(o);
  for (const o of input.extraObstacles ?? []) grid.setObstacle(o);
  grid.finalize(BODY_RADIUS);

  return { grid, lounge, desks: deskInfo, signature: worldSignature(input) };
}
