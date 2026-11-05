import { forward, rectObstacle, type Obstacle, type Vec2 } from "./geometry";

export type SeatKind = "sofa" | "armchair" | "stool";

export interface SeatSpot {
  id: string;
  kind: SeatKind;
  /** Onde fica o quadril de quem senta (chão). */
  pos: Vec2;
  yaw: number;
  /** Ponto livre de onde a pessoa se aproxima antes de sentar. */
  approach: Vec2;
  /** Altura do quadril sentado e inclinação do tronco (negativo = recostado). */
  hipSeat: number;
  backLean: number;
}

export interface StandSpot {
  id: string;
  pos: Vec2;
  yaw: number;
}

export interface ChatPair {
  id: string;
  a: StandSpot;
  b: StandSpot;
}

export interface LoungeFurniture {
  rug: { x: number; z: number; w: number; d: number };
  sofa: { x: number; z: number; yaw: number; length: number };
  armchairs: Array<{ x: number; z: number; yaw: number }>;
  coffeeTable: { x: number; z: number };
  pool: { x: number; z: number; length: number; width: number };
  bar: { x: number; z: number; length: number; depth: number };
  backBar: { x: number; z: number; length: number };
  stools: Vec2[];
  plants: Vec2[];
  art: Array<{ x: number; z: number; w: number; h: number; y: number; wall: "back" | "west" }>;
}

export interface LoungeLayout {
  x0: number;
  width: number;
  depth: number;
  minZ: number;
  maxZ: number;
  seats: SeatSpot[];
  poolSpots: StandSpot[];
  chatPairs: ChatPair[];
  wander: Vec2[];
  obstacles: Obstacle[];
  furniture: LoungeFurniture;
  /** Porta na divisória com a sala dos agentes (lado do lounge). */
  door: Vec2;
}

export const LOUNGE_WIDTH = 13;
export const LOUNGE_MIN_DEPTH = 13;

/**
 * Sala de convivência: mesa de sinuca ao fundo, bar encostado na parede leste (os clientes
 * ficam de frente para a câmera), sofás e poltronas na frente. Tudo é dado puro — o desenho 3D
 * e a navegação dos personagens leem exatamente estas posições.
 *
 * `x0` é a divisória oeste (porta); `depth` é a profundidade das salas (mesma do escritório).
 */
export function computeLoungeLayout(x0: number, depth: number, doorZ: number, width = LOUNGE_WIDTH): LoungeLayout {
  const minZ = -depth / 2;
  const maxZ = depth / 2;
  // u: leste a partir da divisória; v: da parede de fundo para a frente.
  const W = (u: number, v: number): Vec2 => ({ x: x0 + u, z: minZ + v });
  // Itens ancorados na frente acompanham salas mais profundas que o mínimo.
  const s = Math.max(0, depth - LOUNGE_MIN_DEPTH);
  const obstacles: Obstacle[] = [];
  const block = (u: number, v: number, hu: number, hv: number, label: string) => {
    const p = W(u, v);
    obstacles.push(rectObstacle(p.x, p.z, hu, hv, label));
  };

  // ---- sinuca (fundo, oeste) -------------------------------------------------
  const poolC = W(4.3, 4.6);
  block(4.3, 4.6, 1.5, 0.9, "pool");
  const poolSpots: StandSpot[] = [
    { id: "pool-s1", pos: W(3.55, 5.95), yaw: Math.PI },
    { id: "pool-s2", pos: W(5.05, 5.95), yaw: Math.PI },
    { id: "pool-n1", pos: W(3.55, 3.25), yaw: 0 },
    { id: "pool-n2", pos: W(5.05, 3.25), yaw: 0 },
  ];

  // ---- sofás e poltronas (frente) --------------------------------------------
  const sofaV = 8.75 + s;
  const sofaSeats: SeatSpot[] = [4.95, 5.8, 6.65].map((u, i) => ({
    id: `sofa-${i}`,
    kind: "sofa",
    pos: W(u, sofaV + 0.1),
    yaw: 0,
    approach: W(u, sofaV + 1.05),
    hipSeat: 0.5,
    backLean: -0.16,
  }));
  block(5.8, sofaV, 1.5, 0.52, "sofa");
  const armV = 10.0 + s;
  const armchairs = [
    { x: 3.4, yaw: Math.PI / 2, appU: 4.35 },
    { x: 8.2, yaw: -Math.PI / 2, appU: 7.25 },
  ];
  const armSeats: SeatSpot[] = armchairs.map((a, i) => ({
    id: `armchair-${i}`,
    kind: "armchair",
    pos: W(a.x, armV),
    yaw: a.yaw,
    approach: W(a.appU, armV),
    hipSeat: 0.48,
    backLean: -0.2,
  }));
  armchairs.forEach((a) => block(a.x, armV, 0.48, 0.48, "armchair"));
  const tableV = 10.75 + s;
  block(5.8, tableV, 0.68, 0.42, "coffee-table");

  // ---- bar (leste, de frente para a câmera) ----------------------------------
  const barU = 11.6;
  const barV0 = 6.8 + s;
  const barV1 = 12.2 + s;
  const barLen = barV1 - barV0;
  block(barU, (barV0 + barV1) / 2, 0.38, barLen / 2, "bar-counter");
  // atrás do balcão: área do barman + prateleira (ninguém entra)
  block(12.3, (barV0 + barV1) / 2, 0.7, barLen / 2 + 0.1, "bar-back");
  const stoolVs = [7.45, 8.55, 9.65, 10.75, 11.85].map((v) => v + s);
  const stools: Vec2[] = stoolVs.map((v) => W(10.72, v));
  const stoolSeats: SeatSpot[] = stoolVs.map((v, i) => ({
    id: `stool-${i}`,
    kind: "stool",
    pos: W(10.72, v),
    yaw: Math.PI / 2,
    approach: W(9.75, v),
    hipSeat: 0.76,
    backLean: 0.04,
  }));
  stools.forEach((p) => obstacles.push({ kind: "circle", cx: p.x, cz: p.z, r: 0.24, label: "stool" }));

  // ---- conversas em pé ---------------------------------------------------------
  const pair = (id: string, a: Vec2, b: Vec2): ChatPair => ({
    id,
    a: { id: `${id}-a`, pos: a, yaw: Math.atan2(b.x - a.x, b.z - a.z) },
    b: { id: `${id}-b`, pos: b, yaw: Math.atan2(a.x - b.x, a.z - b.z) },
  });
  const chatPairs: ChatPair[] = [
    pair("chat-1", W(8.1, 4.4), W(8.1, 5.4)),
    pair("chat-2", W(1.7, 7.7 + s * 0.5), W(2.7, 7.7 + s * 0.5)),
    pair("chat-3", W(8.9, 2.2), W(9.9, 2.2)),
  ];

  // ---- plantas e decoração fixa ------------------------------------------------
  const plants: Vec2[] = [W(0.65, 0.8), W(12.35, 0.8), W(0.65, depth - 0.7), W(7.9, 0.75)];
  plants.forEach((p) => obstacles.push({ kind: "circle", cx: p.x, cz: p.z, r: 0.34, label: "plant" }));

  const wander = [W(1.5, 2.0), W(6.6, 2.0), W(1.4, 5.6), W(8.6, 7.0 + s * 0.4), W(7.9, depth - 0.9), W(2.8, depth - 0.9)];

  return {
    x0,
    width,
    depth,
    minZ,
    maxZ,
    seats: [...sofaSeats, ...armSeats, ...stoolSeats],
    poolSpots,
    chatPairs,
    wander,
    obstacles,
    furniture: {
      rug: { ...W(5.8, 10.1 + s), w: 5.6, d: 3.4 },
      sofa: { ...W(5.8, sofaV), yaw: 0, length: 2.9 },
      armchairs: armchairs.map((a) => ({ ...W(a.x, armV), yaw: a.yaw })),
      coffeeTable: W(5.8, tableV),
      pool: { x: poolC.x, z: poolC.z, length: 2.74, width: 1.52 },
      bar: { ...W(barU, (barV0 + barV1) / 2), length: barLen, depth: 0.76 },
      backBar: { ...W(12.55, (barV0 + barV1) / 2), length: barLen },
      stools,
      plants,
      art: [
        { x: x0 + 3.0, z: minZ + 0.12, w: 1.6, h: 1.0, y: 2.1, wall: "back" },
        { x: x0 + 5.6, z: minZ + 0.12, w: 1.2, h: 1.2, y: 2.05, wall: "back" },
        { x: x0 + 8.4, z: minZ + 0.12, w: 1.8, h: 1.0, y: 2.1, wall: "back" },
      ],
    },
    door: { x: x0, z: doorZ },
  };
}

export function seatFacingPoint(seat: SeatSpot): Vec2 {
  const f = forward(seat.yaw);
  return { x: seat.pos.x + f.x, z: seat.pos.z + f.z };
}
