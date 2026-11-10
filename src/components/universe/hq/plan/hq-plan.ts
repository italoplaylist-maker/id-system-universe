import { inOrect, inPolygon, toWorld, type Rigid, type Vec2 } from "../life/geometry";

/**
 * Planta do ID System Headquarters: um átrio central poligonal (+0,40 m) de onde partem três alas
 * em direções diferentes — uma planta em "Y" assimétrico. Dado puro: o desenho 3D, a simulação dos
 * personagens e a câmera leem exatamente estes números.
 *
 *   • Ala Tecnológica (projetos, racks, NOC)  — sudoeste, +0,20 m
 *   • Ala Operacional (agentes)               — norte-noroeste, 0,00 m
 *   • Ala AGENTES CLT (equipe de agentes de IA) — leste, +0,10 m
 *
 * Cada ala mantém seu sistema de coordenadas próprio (x = largura, z = profundidade, frente em +z)
 * e é posta no mundo por uma transformação rígida (rotação em Y como no three.js + translação).
 * A porta de cada ala fica no meio da parede leste LOCAL, voltada para o átrio.
 */
export const HQ = {
  ATRIUM_RADIUS: 7.9,
  /** Cota de referência: o terreno externo fica em −0,065 m, então todas as alas sobem 0,30 m (as diferenças entre níveis são as pedidas: átrio +0,40, tecnológica +0,20, operacional 0, social −0,20). */
  BASE: 0.3,
  ATRIUM_LEVEL: 0.7,
  /** Distância do centro do átrio à parede de cada ala (a parede fica logo dentro do polígono). Compacta desde 2026-11-09 (era 9,3 com átrio de 9,6): o limite é o núcleo central (r 3,5 + anel) e a sobreposição entre alas vizinhas. */
  DOOR_DIST: 7.6,
  DOOR_WIDTH: 2.4,
  RAMP_LENGTH: 2.8,
  LEVEL: { tech: 0.5, agents: 0.3, clt: 0.1 },
  WALL: { tech: 4.5, agents: 3.9, clt: 3.9 },
  /** Direção de cada ala (radianos, ângulo no plano x–z a partir de +x, z para a frente/câmera). Múltiplos de 22,5° = meio de uma face do átrio. */
  HEADING: { tech: (135 * Math.PI) / 180, agents: (247.5 * Math.PI) / 180, clt: 0 },
} as const;

export type WingId = "tech" | "agents" | "clt";

export interface WingPlacement extends Rigid {
  id: WingId;
  width: number;
  depth: number;
  level: number;
  wallHeight: number;
  /** Direção "para fora" do átrio. */
  u: Vec2;
  /** Centro da porta no mundo (na parede voltada para o átrio). */
  door: Vec2;
  /** z LOCAL da porta na parede leste da ala. */
  doorZ: number;
}

export interface Ramp {
  wing: WingId;
  /** Retângulo orientado da rampa (já em mundo). */
  rect: { cx: number; cz: number; hx: number; hz: number; rot: number };
  /** Início (nível do átrio) e direção de descida. */
  origin: Vec2;
  dir: Vec2;
  length: number;
  from: number;
  to: number;
}

export interface HqPlan {
  atrium: { center: Vec2; radius: number; level: number; polygon: Vec2[] };
  wings: Record<WingId, WingPlacement>;
  ramps: Ramp[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  center: [number, number, number];
  radius: number;
  /** Altura do piso em (x, z): átrio, rampas e alas têm níveis diferentes. */
  levelAt: (x: number, z: number) => number;
}

export interface HqPlanInput {
  /** `doorZ`: z LOCAL da porta na parede leste da ala (padrão 0 = meio da parede). */
  tech: { width: number; depth: number; doorZ?: number };
  agents: { width: number; depth: number; doorZ?: number };
  clt: { width: number; depth: number; doorZ?: number };
}

function atriumPolygon(radius: number, sides = 16): Vec2[] {
  // Vértices deslocados meia face: o MEIO de cada face cai em múltiplos de 360/sides.
  const off = Math.PI / sides;
  return Array.from({ length: sides }, (_, k) => {
    const a = off + (k * Math.PI * 2) / sides;
    return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
  });
}

function placeRotated(id: WingId, size: { width: number; depth: number; doorZ?: number }): WingPlacement {
  const phi = HQ.HEADING[id];
  const u = { x: Math.cos(phi), z: Math.sin(phi) };
  const rot = Math.PI - phi; // o +x local aponta para o átrio (−u)
  const doorWorld = { x: u.x * HQ.DOOR_DIST, z: u.z * HQ.DOOR_DIST };
  // origem da ala = porta (mundo) − R(rot)·(largura/2, doorZ)
  const off = toWorld({ x: 0, z: 0, rot }, { x: size.width / 2, z: size.doorZ ?? 0 });
  return {
    id,
    x: doorWorld.x - off.x,
    z: doorWorld.z - off.z,
    rot,
    width: size.width,
    depth: size.depth,
    level: HQ.LEVEL[id],
    wallHeight: HQ.WALL[id],
    u,
    door: doorWorld,
    doorZ: size.doorZ ?? 0,
  };
}

export function computeHqPlan(input: HqPlanInput): HqPlan {
  const tech = placeRotated("tech", input.tech);
  const agents = placeRotated("agents", input.agents);
  const clt = placeRotated("clt", input.clt);
  const wings = { tech, agents, clt };
  const polygon = atriumPolygon(HQ.ATRIUM_RADIUS);

  const ramps: Ramp[] = (Object.values(wings) as WingPlacement[]).map((w) => {
    const hz = HQ.DOOR_WIDTH / 2 + 0.3;
    return {
      wing: w.id,
      rect: {
        cx: w.door.x + w.u.x * (HQ.RAMP_LENGTH / 2),
        cz: w.door.z + w.u.z * (HQ.RAMP_LENGTH / 2),
        hx: HQ.RAMP_LENGTH / 2,
        hz,
        // o eixo local x do retângulo corre ao longo de u: rot = θ (x local = −u)
        rot: w.rot,
      },
      origin: w.door,
      dir: w.u,
      length: HQ.RAMP_LENGTH,
      from: HQ.ATRIUM_LEVEL,
      to: w.level,
    };
  });

  const wingRect = (w: WingPlacement) => wingWorldRect(w);

  const levelAt = (x: number, z: number): number => {
    for (const r of ramps) {
      if (inOrect(x, z, r.rect)) {
        const t = Math.min(1, Math.max(0, ((x - r.origin.x) * r.dir.x + (z - r.origin.z) * r.dir.z) / r.length));
        return r.from + (r.to - r.from) * t;
      }
    }
    if (inPolygon(x, z, polygon)) return HQ.ATRIUM_LEVEL;
    for (const w of Object.values(wings)) if (inOrect(x, z, wingRect(w))) return w.level;
    return 0;
  };

  // Caixa envolvente: cantos de cada ala em mundo + o átrio.
  let minX: number = -HQ.ATRIUM_RADIUS;
  let maxX: number = HQ.ATRIUM_RADIUS;
  let minZ: number = -HQ.ATRIUM_RADIUS;
  let maxZ: number = HQ.ATRIUM_RADIUS;
  for (const w of Object.values(wings)) {
    const r = wingRect(w);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = toWorld({ x: r.cx, z: r.cz, rot: r.rot }, { x: sx * r.hx, z: sz * r.hz });
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
  }
  const pad = 1.4;
  const maxWall = Math.max(HQ.WALL.tech, HQ.WALL.agents, HQ.WALL.clt);
  const bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad + 0.6, minY: -0.5, maxY: maxWall + 0.8 };
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const radius = Math.hypot((bounds.maxX - bounds.minX) / 2, (bounds.maxZ - bounds.minZ) / 2, maxWall / 2);
  return {
    atrium: { center: { x: 0, z: 0 }, radius: HQ.ATRIUM_RADIUS, level: HQ.ATRIUM_LEVEL, polygon },
    wings,
    ramps,
    bounds,
    center: [cx, maxWall * 0.3, cz],
    radius,
    levelAt,
  };
}

/** Retângulo (em mundo) da ala — usado para pintar o chão caminhável e para localizar quem está em qual ala. */
export function wingWorldRect(w: WingPlacement) {
  return { cx: w.x, cz: w.z, hx: w.width / 2, hz: w.depth / 2, rot: w.rot };
}
