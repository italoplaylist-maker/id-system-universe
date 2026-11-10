import type { Obstacle, Vec2 } from "../life/geometry";

/** Medidas do núcleo central (ID Command Center). */
export const CORE = { radius: 3.5, platformH: 0.22, ringY: 3.7, screenR: 3.05, screenY: 1.75 };

export const PLANTER_ANGLES = [40, 78, 178, 292, 322].map((d) => (d * Math.PI) / 180);
export const PLANTER_RADIUS = 5.9;

/** Móveis fixos do átrio (mundo): o núcleo e os jardins. O sim os trata como obstáculos. */
export function atriumObstacles(): Obstacle[] {
  return [
    { kind: "circle", cx: 0, cz: 0, r: CORE.radius + 0.1, label: "core" },
    ...PLANTER_ANGLES.map((a): Obstacle => ({ kind: "circle", cx: Math.cos(a) * PLANTER_RADIUS, cz: Math.sin(a) * PLANTER_RADIUS, r: 0.85, label: "planter" })),
  ];
}


/** Pontos do átrio (mundo) onde quem está livre passeia: um anel entre o núcleo e os jardins, um personagem por ponto. */
export const ATRIUM_WANDER: Vec2[] = Array.from({ length: 10 }, (_, k) => {
  const a = ((18 + 36 * k) * Math.PI) / 180;
  return { x: Math.cos(a) * 4.4, z: Math.sin(a) * 4.4 };
});
