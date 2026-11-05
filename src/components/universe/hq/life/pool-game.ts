import type { Vec2 } from "./geometry";

/**
 * Sinuca como dado puro (sem three.js): as bolas vivem aqui, a simulação decide QUEM atira DE ONDE e
 * o desenho 3D só lê as posições. Assim o jogador sempre fica atrás da bola branca, na linha da tacada.
 * Espaço da mesa: x ao longo do comprimento, z na largura, origem no centro do pano.
 */
export const POOL = {
  BALL_R: 0.034,
  PLAY_L: 2.22,
  PLAY_W: 1.08,
  RAIL: 0.24,
  /** Folga entre a borda externa da mesa e o corpo de quem joga. */
  STAND_GAP: 0.62,
  /** Alcance máximo do corpo à bola branca (taco + braço). */
  MAX_REACH: 2.0,
} as const;

export const POOL_OUTER_L = POOL.PLAY_L + POOL.RAIL * 2;
export const POOL_OUTER_W = POOL.PLAY_W + POOL.RAIL * 2;
const HX = POOL_OUTER_L / 2 + POOL.STAND_GAP;
const HZ = POOL_OUTER_W / 2 + POOL.STAND_GAP;

export const POCKETS: Array<[number, number]> = [
  [-POOL.PLAY_L / 2, -POOL.PLAY_W / 2], [0, -POOL.PLAY_W / 2 - 0.02], [POOL.PLAY_L / 2, -POOL.PLAY_W / 2],
  [-POOL.PLAY_L / 2, POOL.PLAY_W / 2], [0, POOL.PLAY_W / 2 + 0.02], [POOL.PLAY_L / 2, POOL.PLAY_W / 2],
];

export function rackPositions(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const x0 = POOL.PLAY_L * 0.22;
  const d = POOL.BALL_R * 2.04;
  for (let row = 0; row < 5; row += 1) for (let k = 0; k <= row; k += 1) out.push([x0 + row * d * 0.866, (k - row / 2) * d]);
  return out;
}

export interface PoolPlan {
  /** Onde o jogador deve estar (espaço da mesa), exatamente atrás da bola branca na linha da tacada. */
  stand: Vec2;
  /** Direção da tacada (yaw do corpo, 0 = +z do mundo; a mesa não é girada). */
  yaw: number;
  target: number;
  stop: [number, number];
  pocket: [number, number];
}

interface Anim {
  ball: number;
  from: [number, number];
  to: [number, number];
  t: number;
  dur: number;
  sink?: boolean;
}

export class PoolGame {
  readonly pos = new Float32Array(32);
  readonly alive = new Uint8Array(16);
  /** Sobe a cada mudança: o desenho só reescreve as instâncias quando muda. */
  version = 0;
  private anim: Anim | null = null;
  private queue: Array<() => void> = [];

  constructor() {
    this.rerack();
  }

  rerack() {
    this.alive.fill(1);
    this.pos[0] = -POOL.PLAY_L * 0.25;
    this.pos[1] = 0;
    rackPositions().forEach((p, i) => {
      this.pos[(i + 1) * 2] = p[0];
      this.pos[(i + 1) * 2 + 1] = p[1];
    });
    this.anim = null;
    this.queue = [];
    this.version += 1;
  }

  get settled(): boolean {
    return !this.anim && this.queue.length === 0;
  }

  /**
   * Escolhe uma bola-alvo e o ponto de onde dá para bater nela: o ponto onde a reta alvo → bola branca,
   * prolongada para trás, atravessa a borda da mesa. `occupied` = outros jogadores (não pode ficar em cima deles).
   */
  plan(occupied: Vec2[], rng: () => number): PoolPlan | null {
    const first = this.planOnce(occupied, rng);
    if (first) return first;
    // Nenhuma jogada alcançável com a branca onde está: "bola na mão" — volta ao ponto de saída (regra de sinuca).
    this.pos[0] = -POOL.PLAY_L * 0.25;
    this.pos[1] = 0;
    this.alive[0] = 1;
    this.version += 1;
    return this.planOnce(occupied, rng);
  }

  private planOnce(occupied: Vec2[], rng: () => number): PoolPlan | null {
    if (!this.alive[0]) return null;
    const cue: [number, number] = [this.pos[0], this.pos[1]];
    const targets: number[] = [];
    for (let i = 1; i < 16; i += 1) if (this.alive[i]) targets.push(i);
    // embaralha de forma determinística pelo rng
    for (let i = targets.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }
    let best: { plan: PoolPlan; reach: number } | null = null;
    for (const t of targets) {
      const obj: [number, number] = [this.pos[t * 2], this.pos[t * 2 + 1]];
      const dx = obj[0] - cue[0];
      const dz = obj[1] - cue[1];
      const len = Math.hypot(dx, dz);
      if (len < POOL.BALL_R * 2.5) continue;
      const ux = dx / len;
      const uz = dz / len;
      // quanto recuar da bola branca (contra a direção da tacada) até sair do retângulo do jogador
      const sx = Math.abs(ux) > 1e-6 ? (HX + Math.sign(ux) * cue[0]) / Math.abs(ux) : Infinity;
      const sz = Math.abs(uz) > 1e-6 ? (HZ + Math.sign(uz) * cue[1]) / Math.abs(uz) : Infinity;
      const s = Math.min(sx, sz);
      const stand: Vec2 = { x: cue[0] - ux * s, z: cue[1] - uz * s };
      if (occupied.some((o) => Math.hypot(o.x - stand.x, o.z - stand.z) < 0.85)) continue;
      let pocket = POCKETS[0];
      let nearest = Infinity;
      for (const p of POCKETS) {
        const d = Math.hypot(p[0] - obj[0], p[1] - obj[1]);
        if (d < nearest) {
          nearest = d;
          pocket = p;
        }
      }
      const plan: PoolPlan = {
        stand,
        yaw: Math.atan2(ux, uz),
        target: t,
        stop: [obj[0] - ux * POOL.BALL_R * 2.1, obj[1] - uz * POOL.BALL_R * 2.1],
        pocket,
      };
      if (s <= POOL.MAX_REACH) return plan;
      if (!best || s < best.reach) best = { plan, reach: s };
    }
    // sem jogada confortável: aceita a menos esticada, desde que o taco ainda alcance
    return best && best.reach <= POOL.MAX_REACH + 0.25 ? best.plan : null;
  }

  /** A tacada acontece: a branca corre até a bola-alvo, que cai na caçapa mais próxima. */
  strike(plan: PoolPlan) {
    if (!this.settled) return;
    const t = plan.target;
    const obj: [number, number] = [this.pos[t * 2], this.pos[t * 2 + 1]];
    const cue: [number, number] = [this.pos[0], this.pos[1]];
    const toPocket = Math.hypot(plan.pocket[0] - obj[0], plan.pocket[1] - obj[1]);
    this.anim = { ball: 0, from: cue, to: plan.stop, t: 0, dur: 0.7 };
    this.queue.push(() => {
      this.anim = { ball: t, from: obj, to: [plan.pocket[0] * 0.98, plan.pocket[1] * 0.98], t: 0, dur: 0.8 + toPocket * 0.5, sink: true };
      this.pos[0] = plan.stop[0];
      this.pos[1] = plan.stop[1];
    });
    this.version += 1;
  }

  step(dt: number) {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const e = 1 - (1 - k) * (1 - k);
    this.pos[a.ball * 2] = a.from[0] + (a.to[0] - a.from[0]) * e;
    this.pos[a.ball * 2 + 1] = a.from[1] + (a.to[1] - a.from[1]) * e;
    this.version += 1;
    if (k < 1) return;
    if (a.sink) this.alive[a.ball] = 0;
    this.anim = null;
    const next = this.queue.shift();
    if (next) next();
    else if (this.alive.reduce((n, v, i) => n + (i > 0 ? v : 0), 0) <= 3) this.rerack();
  }
}
