/** Coordenadas do mundo do HQ: x leste, z para a frente (câmera), y para cima. yaw 0 = olhando para +z. */
export interface Vec2 {
  x: number;
  z: number;
}

export type Obstacle =
  | { kind: "rect"; minX: number; maxX: number; minZ: number; maxZ: number; label?: string }
  | { kind: "circle"; cx: number; cz: number; r: number; label?: string }
  /** Retângulo orientado (alas giradas): centro, meias-medidas locais e rotação em torno de Y (mesma convenção do three.js). */
  | { kind: "orect"; cx: number; cz: number; hx: number; hz: number; rot: number; label?: string };

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

/** Ponto local → mundo, para uma transformação rígida (rotação em Y como no three.js + translação). */
export interface Rigid {
  x: number;
  z: number;
  rot: number;
}

export function toWorld(t: Rigid, p: Vec2): Vec2 {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return { x: t.x + p.x * c + p.z * s, z: t.z - p.x * s + p.z * c };
}

/** Rumo (yaw) local → mundo. Em three.js `rotation.y = rot` soma `rot` ao yaw. */
export function yawToWorld(t: Rigid, yaw: number): number {
  return yaw + t.rot;
}

export function obstacleToWorld(t: Rigid, o: Obstacle): Obstacle {
  if (o.kind === "circle") {
    const p = toWorld(t, { x: o.cx, z: o.cz });
    return { kind: "circle", cx: p.x, cz: p.z, r: o.r, label: o.label };
  }
  if (o.kind === "rect") {
    const p = toWorld(t, { x: (o.minX + o.maxX) / 2, z: (o.minZ + o.maxZ) / 2 });
    return { kind: "orect", cx: p.x, cz: p.z, hx: (o.maxX - o.minX) / 2, hz: (o.maxZ - o.minZ) / 2, rot: t.rot, label: o.label };
  }
  const p = toWorld(t, { x: o.cx, z: o.cz });
  return { ...o, cx: p.x, cz: p.z, rot: o.rot + t.rot };
}

/** Ponto dentro de um retângulo orientado? */
export function inOrect(px: number, pz: number, o: { cx: number; cz: number; hx: number; hz: number; rot: number }): boolean {
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  // inversa da rotação: local = R(-rot) * d
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= o.hx && Math.abs(lz) <= o.hz;
}

/** Ponto dentro de um polígono (par-ímpar)? */
export function inPolygon(px: number, pz: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
