/** Coordenadas do mundo do HQ: x leste, z para a frente (câmera), y para cima. yaw 0 = olhando para +z. */
export interface Vec2 {
  x: number;
  z: number;
}

export type Obstacle =
  | { kind: "rect"; minX: number; maxX: number; minZ: number; maxZ: number; label?: string }
  | { kind: "circle"; cx: number; cz: number; r: number; label?: string };

export function rectObstacle(cx: number, cz: number, halfX: number, halfZ: number, label?: string): Obstacle {
  return { kind: "rect", minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ, label };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Menor diferença angular em (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function yawToward(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Direção em que um corpo com este yaw está olhando. */
export function forward(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** RNG determinístico (mulberry32): a simulação visual é reproduzível nos testes. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
