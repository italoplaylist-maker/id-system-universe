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
  sofas: Array<{ x: number; z: number; yaw: number; length: number }>;
  armchairs: Array<{ x: number; z: number; yaw: number }>;
  coffeeTables: Vec2[];
  floorLamps: Vec2[];
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

export const LOUNGE_WIDTH = 16;
export const LOUNGE_MIN_DEPTH = 14.4;

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
  block(4.3, 4.6, 1.4, 0.82, "pool");
  const poolSpots: StandSpot[] = [
    { id: "pool-s1", pos: W(3.55, 5.95), yaw: Math.PI },
    { id: "pool-s2", pos: W(5.05, 5.95), yaw: Math.PI },
    { id: "pool-n1", pos: W(3.55, 3.25), yaw: 0 },
    { id: "pool-n2", pos: W(5.05, 3.25), yaw: 0 },
  ];

  // ---- sofás e poltronas (frente): dois grupos de sofá + mesa de centro, três poltronas ------------
  const sofaV = 9.45 + s;
  // Grupo 1: sofá + poltrona. Grupo 2: sofá em U (sofá de fundo + dois laterais) em volta da mesa de centro, aberto para a câmera.
  const sofaCenters = [4.75, 9.2];
  const sofaSeats: SeatSpot[] = sofaCenters.flatMap((cu, g) =>
    [-0.85, 0, 0.85].map((du, i) => ({
      id: `sofa-${g * 3 + i}`,
      kind: "sofa" as const,
      pos: W(cu + du, sofaV + 0.1),
      yaw: 0,
      approach: W(cu + du, sofaV + 1.05),
      hipSeat: 0.5,
      backLean: -0.16,
    })),
  );
  sofaCenters.forEach((cu) => block(cu, sofaV, 1.5, 0.52, "sofa"));
  const tableV = 11.45 + s;
  // Sofás laterais do U (2 lugares cada), de frente um para o outro, a mesa de centro entre eles.
  const uCenter = sofaCenters[1];
  const sideSofas = [
    { u: uCenter - 2.4, yaw: Math.PI / 2, appDu: 1.05 },
    { u: uCenter + 2.4, yaw: -Math.PI / 2, appDu: -1.05 },
  ];
  const sideSeats: SeatSpot[] = sideSofas.flatMap((sf, g) =>
    [-0.45, 0.45].map((dv, k) => ({
      id: `sofa-${6 + g * 2 + k}`,
      kind: "sofa" as const,
      pos: W(sf.u, tableV + dv),
      yaw: sf.yaw,
      approach: W(sf.u + sf.appDu, tableV + dv),
      hipSeat: 0.5,
      backLean: -0.16,
    })),
  );
  sideSofas.forEach((sf) => block(sf.u, tableV, 0.52, 0.95, "sofa"));
  const armV = 10.7 + s;
  const armchairs = [{ x: 2.35, yaw: Math.PI / 2, appU: 3.3 }];
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
  sofaCenters.forEach((cu) => block(cu, tableV, 0.68, 0.42, "coffee-table"));
  const lampP = W(11.4, sofaV - 0.2);
  obstacles.push({ kind: "circle", cx: lampP.x, cz: lampP.z, r: 0.25, label: "floor-lamp" });

  // ---- bar (leste, de frente para a câmera): 7 banquetas ----------------------------------
  const barU = 14.6;
  const barV0 = 6.7;
  const barV1 = 13.5 + s;
  const barLen = barV1 - barV0;
  block(barU, (barV0 + barV1) / 2, 0.38, barLen / 2, "bar-counter");
  // atrás do balcão: área do barman + prateleira (ninguém entra)
  block(barU + 0.7, (barV0 + barV1) / 2, 0.7, barLen / 2 + 0.1, "bar-back");
  const stoolVs = Array.from({ length: 7 }, (_, i) => 7.5 + i * 0.93 + (i / 6) * s);
  const stools: Vec2[] = stoolVs.map((v) => W(barU - 0.88, v));
  const stoolSeats: SeatSpot[] = stoolVs.map((v, i) => ({
    id: `stool-${i}`,
    kind: "stool",
    pos: W(barU - 0.88, v),
    yaw: Math.PI / 2,
    approach: W(barU - 1.85, v),
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
    pair("chat-4", W(12.6, 3.2), W(12.6, 4.2)),
  ];

  // ---- plantas e decoração fixa ------------------------------------------------
  const plants: Vec2[] = [W(0.65, 0.8), W(width - 0.65, 0.8), W(0.65, depth - 0.7), W(7.9, 0.75), W(13.6, 0.8)];
  plants.forEach((p) => obstacles.push({ kind: "circle", cx: p.x, cz: p.z, r: 0.34, label: "plant" }));

  const wander = [W(1.5, 2.0), W(6.6, 2.0), W(1.4, 5.6), W(8.6, 7.4 + s * 0.4), W(7.9, depth - 0.9), W(2.8, depth - 0.9), W(11.0, 2.2), W(12.4, 6.0)];

  return {
    x0,
    width,
    depth,
    minZ,
    maxZ,
    seats: [...sofaSeats, ...sideSeats, ...armSeats, ...stoolSeats],
    poolSpots,
    chatPairs,
    wander,
    obstacles,
    furniture: {
      rug: { ...W(7.4, 10.8 + s), w: 12.2, d: 4.6 },
      sofas: [...sofaCenters.map((cu) => ({ ...W(cu, sofaV), yaw: 0, length: 2.9 })), ...sideSofas.map((sf) => ({ ...W(sf.u, tableV), yaw: sf.yaw, length: 1.9 }))],
      armchairs: armchairs.map((a) => ({ ...W(a.x, armV), yaw: a.yaw })),
      coffeeTables: sofaCenters.map((cu) => W(cu, tableV)),
      floorLamps: [lampP],
      pool: { x: poolC.x, z: poolC.z, length: 2.74, width: 1.52 },
      bar: { ...W(barU, (barV0 + barV1) / 2), length: barLen, depth: 0.76 },
      backBar: { ...W(barU + 0.95, (barV0 + barV1) / 2), length: barLen },
      stools,
      plants,
      art: [
        { x: x0 + 3.0, z: minZ + 0.12, w: 1.6, h: 1.0, y: 2.1, wall: "back" },
        { x: x0 + 5.6, z: minZ + 0.12, w: 1.2, h: 1.2, y: 2.05, wall: "back" },
        { x: x0 + 8.4, z: minZ + 0.12, w: 1.8, h: 1.0, y: 2.1, wall: "back" },
        { x: x0 + 10.6, z: minZ + 0.12, w: 1.3, h: 1.1, y: 2.05, wall: "back" },
      ],
    },
    door: { x: x0, z: doorZ },
  };
}

export function seatFacingPoint(seat: SeatSpot): Vec2 {
  const f = forward(seat.yaw);
  return { x: seat.pos.x + f.x, z: seat.pos.z + f.z };
}
