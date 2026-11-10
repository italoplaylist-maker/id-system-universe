import { angleDelta, dist, forward, makeRng, type Vec2 } from "./geometry";
import type { DeskInfo, LifeWorld } from "./world";

/**
 * Simulação VISUAL da vida dos agentes. Lê o estado real (precisa trabalhar? está digitando?)
 * e decide onde cada personagem fica e o que faz — nunca escreve nada de volta no sistema.
 * Quem tem trabalho fica na mesa; quem está livre descansa sentado e, de tempos em tempos, passeia pelo átrio
 * e volta. Peças: fases (desk/rising/walking/sitting/standing), reservas de lugares, A* na malha do mundo,
 * desvio entre personagens e recuperação de travamentos.
 */

export type Phase = "desk" | "rising" | "walking" | "sitting" | "standing";
export type Activity = "working" | "going_to_work" | "resting" | "walking" | "wandering";

export type Intent = { kind: "work" } | { kind: "wander"; point: Vec2; key: string | null };

/** O que o rig do personagem lê a cada frame (valores já suavizados). */
export interface ActorVisual {
  gait: number;
  walk: number;
  sit: number;
  hipSeat: number;
  backLean: number;
  work: number;
}

export interface Actor {
  id: string;
  seed: number;
  x: number;
  z: number;
  yaw: number;
  phase: Phase;
  intent: Intent;
  activity: Activity;
  mustWork: boolean;
  working: boolean;
  desk: DeskInfo;
  vis: ActorVisual;
  path: Vec2[];
  speed: number;
  pace: number;
  phaseT: number;
  phaseDur: number;
  from: Vec2;
  to: Vec2;
  toYaw: number;
  dwell: number;
  leaveDelay: number;
  idleFor: number;
  arrived: boolean;
  reservation: string | null;
  wanderStreak: number;
  stuckT: number;
  stuckRef: Vec2;
  stuckCount: number;
  recoveries: number;
  waitT: number;
  /** Cedeu passagem: espera aqui antes de retomar o caminho. */
  holdT: number;
  retreating: boolean;
  replanT: number;
}

export interface SyncInput {
  id: string;
  seed: number;
  /** Tem trabalho real (trabalhando, aguardando aprovação ou com erro) — precisa estar na mesa. */
  mustWork: boolean;
  /** Digitando de fato (animação de trabalho). */
  working: boolean;
}

const WALK_SPEED = 1.25;
const SEPARATION_RADIUS = 0.62;
const RISE_DUR = 0.75;
const SIT_DUR = 0.85;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

function newVisual(): ActorVisual {
  return { gait: 0, walk: 0, sit: 1, hipSeat: 0.5, backLean: 0.1, work: 0 };
}

export class LifeSim {
  readonly actors = new Map<string, Actor>();
  private world: LifeWorld | null = null;
  private rng: () => number;
  private reservations = new Map<string, string>();
  private visuals = new Map<string, ActorVisual>();
  time = 0;
  /** Já recebeu o primeiro retrato do estado real? Só nele os ociosos já nascem passeando pelo átrio. */
  initialized = false;

  constructor(seed = 1) {
    this.rng = makeRng(seed);
  }

  /** O objeto visual de um agente existe antes do actor (o avatar já pode ser desenhado); a simulação o adota ao criar o actor. */
  visualFor(id: string): ActorVisual {
    let v = this.visuals.get(id);
    if (!v) {
      v = newVisual();
      this.visuals.set(id, v);
    }
    return v;
  }


  // ---------------------------------------------------------------------------
  // Mundo e entrada (estado real)
  // ---------------------------------------------------------------------------

  setWorld(world: LifeWorld) {
    const changed = !this.world || this.world.signature !== world.signature;
    this.world = world;
    if (!changed) return;
    for (const a of this.actors.values()) {
      const desk = world.desks.get(a.id);
      if (desk) a.desk = desk;
      // O layout mudou sob os pés: quem está parado numa mesa acompanha o móvel; quem anda replaneja.
      if (a.phase === "desk" || (a.phase === "sitting" && a.intent.kind === "work")) {
        a.x = a.desk.seat.x;
        a.z = a.desk.seat.z;
        a.to = a.desk.seat;
      } else if (a.phase === "standing") {
        const spot = this.spotFor(a);
        if (spot) {
          a.x = spot.x;
          a.z = spot.z;
        }
      } else if (a.phase === "walking") {
        this.replan(a);
      }
      if (a.phase !== "desk" && a.phase !== "walking" && a.phase !== "rising" && a.phase !== "sitting" && a.phase !== "standing" && !world.grid.isFree(a.x, a.z)) {
        const p = world.grid.nearestFree(a.x, a.z);
        if (p) {
          a.x = p.x;
          a.z = p.z;
        }
      }
    }
  }

  /** Sincroniza com o estado real: cria quem apareceu, remove quem sumiu (offline), atualiza prioridades. */
  sync(inputs: SyncInput[], options: { instant?: boolean } = {}) {
    if (!this.world) return;
    const seen = new Set<string>();
    for (const input of inputs) {
      seen.add(input.id);
      const desk = this.world.desks.get(input.id);
      if (!desk) continue;
      let a = this.actors.get(input.id);
      if (!a) {
        a = this.spawn(input, desk);
        this.actors.set(a.id, a);
        // Primeiro retrato do estado real: quem não está trabalhando já está passeando (ninguém "finge" trabalhar na mesa).
        if (options.instant && !input.mustWork) this.placeInstant(a);
      }
      const wasMustWork = a.mustWork;
      a.working = input.working;
      a.mustWork = input.mustWork;
      if (input.mustWork && !wasMustWork) this.interruptForWork(a);
      if (!input.mustWork && wasMustWork) a.leaveDelay = 1.2 + this.rng() * 2.3;
    }
    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) this.remove(id);
    }
    this.initialized = true;
  }

  /** Coloca o personagem direto no ponto do átrio (sem caminhar): só para o estado inicial da tela. */
  private placeInstant(a: Actor) {
    const intent = this.choose(a);
    if (intent.kind !== "wander") return; // sem ponto livre: fica na mesa
    a.intent = intent;
    a.activity = this.activityFor(intent);
    a.arrived = true;
    a.path = [];
    a.idleFor = 0;
    a.phase = "standing";
    a.x = intent.point.x;
    a.z = intent.point.z;
    a.vis.sit = 0;
    a.toYaw = a.yaw;
    a.dwell = this.dwellFor() * (0.3 + this.rng() * 0.7);
    a.waitT = 0;
  }

  private spawn(input: SyncInput, desk: DeskInfo): Actor {
    return {
      id: input.id,
      seed: input.seed,
      x: desk.seat.x,
      z: desk.seat.z,
      yaw: desk.yaw,
      phase: "desk",
      intent: { kind: "work" },
      activity: input.mustWork ? "working" : "resting",
      mustWork: input.mustWork,
      working: input.working,
      desk,
      vis: this.visualFor(input.id),
      path: [],
      speed: 0,
      pace: 0.92 + (input.seed % 17) / 100,
      phaseT: 0,
      phaseDur: 1,
      from: desk.seat,
      to: desk.seat,
      toYaw: desk.yaw,
      dwell: 0,
      leaveDelay: input.mustWork ? 0 : 3 + this.rng() * 40,
      idleFor: 0,
      arrived: true,
      reservation: null,
      wanderStreak: 0,
      stuckT: 0,
      stuckRef: { x: desk.seat.x, z: desk.seat.z },
      stuckCount: 0,
      recoveries: 0,
      waitT: 0,
      holdT: 0,
      retreating: false,
      replanT: 0,
    };
  }

  private remove(id: string) {
    const a = this.actors.get(id);
    if (a) this.release(a);
    this.actors.delete(id);
    this.visuals.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Reservas (dois personagens nunca escolhem o mesmo ponto do átrio)
  // ---------------------------------------------------------------------------

  private claim(key: string, a: Actor): boolean {
    const holder = this.reservations.get(key);
    if (holder && holder !== a.id && this.actors.has(holder)) return false;
    if (a.reservation && a.reservation !== key) this.release(a);
    this.reservations.set(key, a.id);
    a.reservation = key;
    return true;
  }

  private release(a: Actor) {
    if (a.reservation && this.reservations.get(a.reservation) === a.id) this.reservations.delete(a.reservation);
    a.reservation = null;
  }

  private isTaken(key: string): boolean {
    const holder = this.reservations.get(key);
    return !!holder && this.actors.has(holder);
  }

  private spotFor(a: Actor): Vec2 | null {
    return a.intent.kind === "wander" ? a.intent.point : null;
  }

  // ---------------------------------------------------------------------------
  // Decisão: o que fazer quando está livre
  // ---------------------------------------------------------------------------

  /** Livre: passeia até um ponto vago do átrio; depois de dois passeios seguidos (ou sem ponto vago) volta a descansar na mesa. */
  private choose(a: Actor): Intent {
    const free = this.world!.wander.map((p, i) => ({ p, key: `wander-${i}` })).filter((w) => !this.isTaken(w.key));
    if (a.wanderStreak < 2 && free.length) {
      const w = free[Math.floor(this.rng() * free.length)];
      if (this.claim(w.key, a)) {
        a.wanderStreak += 1;
        return { kind: "wander", point: w.p, key: w.key };
      }
    }
    this.release(a);
    a.wanderStreak = 0;
    return { kind: "work" };
  }

  private activityFor(intent: Intent): Activity {
    return intent.kind === "wander" ? "wandering" : "going_to_work";
  }

  // ---------------------------------------------------------------------------
  // Interrupção: chegou trabalho de verdade
  // ---------------------------------------------------------------------------

  private interruptForWork(a: Actor) {
    this.release(a);
    a.intent = { kind: "work" };
    a.activity = a.phase === "desk" ? "working" : "going_to_work";
    a.wanderStreak = 0;
    switch (a.phase) {
      case "desk":
      case "sitting": // já sentando na mesa: segue
      case "rising": // já levantando: ao terminar, segue para a mesa
        return;
      case "standing":
      case "walking":
        a.phase = "walking";
        a.arrived = false;
        this.replan(a);
        return;
    }
  }

  private atDeskSeat(a: Actor) {
    return dist({ x: a.x, z: a.z }, a.desk.seat) < 0.05;
  }

  private approachFromHere(a: Actor): Vec2 {
    const f = forward(a.yaw);
    return { x: a.x - f.x * 0.9, z: a.z - f.z * 0.9 };
  }

  // ---------------------------------------------------------------------------
  // Passo de simulação
  // ---------------------------------------------------------------------------

  /** Avança `rawDt` segundos. Intervalos longos viram vários passos curtos (o chamador limita o quadro em 0,4 s). */
  step(rawDt: number) {
    if (!this.world) return;
    let left = Math.min(Math.max(rawDt, 0), 30);
    while (left > 1e-6) {
      const dt = Math.min(left, 1 / 20);
      left -= dt;
      this.time += dt;
      for (const a of this.actors.values()) this.stepActor(a, dt);
    }
  }

  private stepActor(a: Actor, dt: number) {
    switch (a.phase) {
      case "desk":
        this.stepDesk(a, dt);
        break;
      case "rising":
        this.stepRising(a, dt);
        break;
      case "walking":
        this.stepWalking(a, dt);
        break;
      case "sitting":
        this.stepSitting(a, dt);
        break;
      case "standing":
        this.stepStanding(a, dt);
        break;
    }
    this.updateVisual(a, dt);
  }

  private stepDesk(a: Actor, dt: number) {
    a.activity = a.mustWork ? "working" : "resting";
    if (a.mustWork) {
      a.idleFor = 0;
      return;
    }
    a.idleFor += dt;
    if (a.idleFor >= a.leaveDelay) {
      a.idleFor = 0;
      const next = this.choose(a);
      if (next.kind !== "wander") {
        a.leaveDelay = 4 + this.rng() * 8; // sem ponto vago no átrio: tenta de novo daqui a pouco
        return;
      }
      a.intent = next;
      a.activity = this.activityFor(next);
      this.startRising(a, a.desk.approach);
    }
  }

  /** Levantar: o tronco sobe e o quadril sai da cadeira até o ponto de aproximação. */
  private startRising(a: Actor, to: Vec2) {
    a.phase = "rising";
    a.phaseT = 0;
    a.phaseDur = RISE_DUR;
    a.from = { x: a.x, z: a.z };
    a.to = to;
    a.path = [];
  }

  private stepRising(a: Actor, dt: number) {
    // Espera (até 2,5 s) enquanto alguém passa pelo ponto onde vai pisar ao levantar.
    if (a.phaseT === 0 && a.waitT < 2.5) {
      for (const o of this.actors.values()) {
        if (o !== a && o.phase === "walking" && dist(o, a.to) < 0.75) {
          a.waitT += dt;
          return;
        }
      }
    }
    a.waitT = 0;
    a.phaseT += dt;
    const k = ease(clamp01(a.phaseT / a.phaseDur));
    a.x = a.from.x + (a.to.x - a.from.x) * k;
    a.z = a.from.z + (a.to.z - a.from.z) * k;
    a.vis.sit = 1 - k;
    if (a.phaseT < a.phaseDur) return;
    a.vis.sit = 0;
    a.x = a.to.x;
    a.z = a.to.z;
    if (a.mustWork) {
      a.intent = { kind: "work" };
    } else if (a.intent.kind === "work") {
      a.intent = this.choose(a);
    } else if (a.intent.kind === "wander" && !this.reservedBy(a)) {
      // a reserva foi feita antes de levantar; se algo a tomou, escolhe de novo
      a.intent = this.choose(a);
    }
    a.activity = this.activityFor(a.intent);
    this.beginWalk(a);
  }

  private reservedBy(a: Actor): boolean {
    return !!a.reservation && this.reservations.get(a.reservation) === a.id;
  }

  private goalFor(a: Actor): Vec2 {
    return a.intent.kind === "wander" ? a.intent.point : a.desk.approach;
  }

  private beginWalk(a: Actor) {
    a.phase = "walking";
    a.arrived = false;
    a.stuckT = 0;
    a.stuckCount = 0;
    a.stuckRef = { x: a.x, z: a.z };
    this.replan(a);
  }

  private replan(a: Actor) {
    const world = this.world!;
    const goal = this.goalFor(a);
    const me = { x: a.x, z: a.z };
    const blockers: Vec2[] = [];
    for (const o of this.actors.values()) {
      if (o === a) continue;
      if (o.phase === "walking" || o.phase === "rising" || o.phase === "sitting") continue;
      if (dist(o, goal) < 0.6 || dist(o, me) < 0.5) continue;
      blockers.push({ x: o.x, z: o.z });
    }
    let path = world.grid.findPath(me, goal, blockers);
    if (!path && blockers.length) path = world.grid.findPath(me, goal);
    if (!path) {
      // Sem caminho: ponto livre mais próximo como último recurso (exceção registrada).
      const p = world.grid.nearestFree(a.x, a.z, 3);
      a.recoveries += 1;
      if (p) {
        a.x = p.x;
        a.z = p.z;
        path = world.grid.findPath(p, goal);
      }
    }
    a.path = path ?? [];
  }

  private stepWalking(a: Actor, dt: number) {
    const world = this.world!;
    const goal = this.goalFor(a);
    a.activity = a.intent.kind === "work" ? "going_to_work" : "walking";

    // Cedendo passagem: espera um instante no recuo e retoma o caminho.
    if (a.holdT > 0) {
      a.holdT -= dt;
      a.speed = damp(a.speed, 0, 8, dt);
      if (a.holdT <= 0) {
        a.retreating = false;
        this.replan(a);
      }
      return;
    }

    // Destino mudou de lugar (reflow) ou o caminho acabou longe do destino: replaneja.
    if (a.path.length === 0 && dist(a, goal) > 0.2) {
      this.replan(a);
      if (a.path.length === 0) {
        a.stuckCount += 1;
        return;
      }
    }

    a.replanT += dt;
    if (a.replanT >= 0.7) {
      a.replanT = 0;
      if (!a.retreating && this.pathBlockedByBody(a)) this.replan(a);
    }

    const target = a.path[0] ?? goal;
    const dx = target.x - a.x;
    const dz = target.z - a.z;
    const d = Math.hypot(dx, dz);
    const isLast = a.path.length <= 1;
    const slow = isLast ? clamp01(d / 0.9) * 0.75 + 0.25 : 1;
    const desired = WALK_SPEED * a.pace * slow;
    a.speed = damp(a.speed, desired, 5, dt);

    let vx = d > 1e-6 ? (dx / d) * a.speed : 0;
    let vz = d > 1e-6 ? (dz / d) * a.speed : 0;

    // Desvio entre personagens: afastamento suave + regra "manter a direita" em encontros de frente.
    for (const o of this.actors.values()) {
      if (o === a) continue;
      const ox = a.x - o.x;
      const oz = a.z - o.z;
      const od = Math.hypot(ox, oz);
      if (od > SEPARATION_RADIUS || od < 1e-4) continue;
      const push = ((SEPARATION_RADIUS - od) / SEPARATION_RADIUS) * (o.phase === "walking" ? 1.4 : 1.8);
      vx += (ox / od) * push;
      vz += (oz / od) * push;
      if (o.phase === "walking" && d > 1e-6) {
        const towardMe = (-ox * (dx / d) - oz * (dz / d)) / od;
        const headOn = (o.path[0] ? ((o.path[0].x - o.x) * (dx / d) + (o.path[0].z - o.z) * (dz / d)) : 0) < 0;
        if (towardMe > 0.5 && headOn) {
          // perpendicular à direita de quem anda
          vx += (dz / d) * 0.55;
          vz += (-dx / d) * 0.55;
        }
      }
    }

    this.moveWithCollision(a, vx * dt, vz * dt);
    if (Math.hypot(vx, vz) > 0.05) {
      const targetYaw = Math.atan2(vx, vz);
      a.yaw += angleDelta(a.yaw, targetYaw) * (1 - Math.exp(-9 * dt));
    }
    a.vis.gait += Math.hypot(vx, vz) * dt * 5.2;

    if (d < 0.14 && a.path.length > 0) a.path.shift();
    if (a.retreating && a.path.length === 0) {
      a.holdT = 1.4 + this.rng() * 0.8;
      return;
    }
    if (a.path.length === 0 && dist(a, goal) < 0.3) this.arrive(a);

    // Travamento: quase sem progresso por 1,5 s → replaneja contornando quem está parado; depois, recuperação.
    a.stuckT += dt;
    if (a.stuckT >= 1.5) {
      const moved = dist(a, a.stuckRef);
      a.stuckT = 0;
      a.stuckRef = { x: a.x, z: a.z };
      if (moved < 0.25 && a.phase === "walking") {
        a.stuckCount += 1;
        if (a.stuckCount >= 2 && !a.retreating && this.yieldPassage(a)) return;
        if (a.stuckCount >= 4) {
          // Último recurso: sai do aperto para o ponto livre mais folgado perto de onde está (longe dos outros), não para o mesmo lugar.
          const p = this.roomiestNearby(a) ?? world.grid.nearestFree(a.x, a.z, 2.5);
          if (p) {
            a.x = p.x;
            a.z = p.z;
          }
          a.recoveries += 1;
          a.stuckCount = 0;
        }
        this.replan(a);
      } else {
        a.stuckCount = 0;
      }
    }
  }

  /** Ponto livre e folgado a 0,8–2 m de `a` que fica mais longe de todos os outros personagens. */
  private roomiestNearby(a: Actor): Vec2 | null {
    const grid = this.world!.grid;
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (const r of [0.8, 1.3, 2.0]) {
      for (let k = 0; k < 16; k += 1) {
        const ang = (k / 16) * Math.PI * 2;
        const p = { x: a.x + Math.cos(ang) * r, z: a.z + Math.sin(ang) * r };
        if (!grid.isRoomy(p.x, p.z)) continue;
        let nearest = Infinity;
        for (const o of this.actors.values()) if (o !== a) nearest = Math.min(nearest, dist(p, o));
        if (nearest > bestScore) {
          bestScore = nearest;
          best = p;
        }
      }
      if (best && bestScore > 0.9) break;
    }
    return best;
  }

  /** Quem está parado (sentando, levantando, em pé numa atividade) é um corpo: ninguém passa por dentro. */
  private blockedByBody(a: Actor, x: number, z: number): boolean {
    for (const o of this.actors.values()) {
      if (o === a) continue;
      const now = Math.hypot(a.x - o.x, a.z - o.z);
      const next = Math.hypot(x - o.x, z - o.z);
      const zone = o.phase === "walking" ? 0.42 : 0.5;
      // Não entra na zona do outro; quem já está dentro dela pode sair em qualquer direção que não cole mais.
      if (next < zone && next < now - 1e-4 && (now >= zone || next < 0.34)) return true;
    }
    return false;
  }

  /** Dois frente a frente num corredor estreito: quem tem id maior recua para um ponto largo e deixa o outro passar. */
  private yieldPassage(a: Actor): boolean {
    const world = this.world!;
    let other: Actor | null = null;
    let best = 1.1;
    for (const o of this.actors.values()) {
      if (o === a || o.phase !== "walking") continue;
      const d = dist(a, o);
      if (d < best) {
        best = d;
        other = o;
      }
    }
    if (!other || !(a.id > other.id)) return false;
    for (let r = 1.0; r <= 5.0; r += 0.5) {
      let pick: Vec2 | null = null;
      let pickScore = Infinity;
      for (let k = 0; k < 24; k += 1) {
        const ang = (k / 24) * Math.PI * 2;
        const p = { x: a.x + Math.cos(ang) * r, z: a.z + Math.sin(ang) * r };
        if (!world.grid.isRoomy(p.x, p.z)) continue;
        const away = dist(p, other);
        if (away < 1.0) continue;
        const score = -away;
        if (score < pickScore) {
          pickScore = score;
          pick = p;
        }
      }
      if (!pick) continue;
      const path = world.grid.findPath(a, pick, [{ x: other.x, z: other.z }], 0.3);
      if (path && path.length > 0) {
        a.path = path;
        a.retreating = true;
        a.stuckCount = 0;
        return true;
      }
    }
    return false;
  }

  /** Alguém parou em cima do caminho que eu planejei: contorna. */
  private pathBlockedByBody(a: Actor): boolean {
    const goal = this.goalFor(a);
    let from: Vec2 = a;
    for (const wp of a.path.slice(0, 3)) {
      for (const o of this.actors.values()) {
        if (o === a || o.phase === "walking") continue;
        if (dist(o, goal) < 0.7) continue;
        // distância do corpo ao segmento from→wp
        const sx = wp.x - from.x;
        const sz = wp.z - from.z;
        const len2 = sx * sx + sz * sz;
        const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((o.x - from.x) * sx + (o.z - from.z) * sz) / len2));
        if (Math.hypot(from.x + sx * t - o.x, from.z + sz * t - o.z) < 0.5) return true;
      }
      from = wp;
    }
    return false;
  }

  private moveWithCollision(a: Actor, mx: number, mz: number) {
    const grid = this.world!.grid;
    const ok = (x: number, z: number) => !grid.isSolid(x, z) && !this.blockedByBody(a, x, z);
    if (ok(a.x + mx, a.z + mz)) {
      a.x += mx;
      a.z += mz;
    } else if (ok(a.x + mx, a.z)) a.x += mx;
    else if (ok(a.x, a.z + mz)) a.z += mz;
  }
  private arrive(a: Actor) {
    a.speed = 0;
    a.arrived = true;
    a.path = [];
    a.activity = this.activityFor(a.intent);
    if (a.intent.kind === "work") {
      this.startSitting(a);
      return;
    }
    a.phase = "standing";
    a.phaseT = 0;
    a.toYaw = a.yaw;
    a.dwell = this.dwellFor();
    a.waitT = 0;
  }

  /** Quanto tempo fica parado num ponto do átrio antes de ir embora. */
  private dwellFor(): number {
    return 14 + this.rng() * 16;
  }

  private startSitting(a: Actor) {
    a.phase = "sitting";
    a.phaseT = 0;
    a.phaseDur = SIT_DUR;
    a.from = { x: a.x, z: a.z };
    a.to = a.desk.seat;
    a.toYaw = a.desk.yaw;
    a.vis.hipSeat = 0.5;
    a.vis.backLean = 0.1;
  }

  private stepSitting(a: Actor, dt: number) {
    a.phaseT += dt;
    const k = ease(clamp01(a.phaseT / a.phaseDur));
    a.x = a.from.x + (a.to.x - a.from.x) * k;
    a.z = a.from.z + (a.to.z - a.from.z) * k;
    a.yaw += angleDelta(a.yaw, a.toYaw) * (1 - Math.exp(-10 * dt));
    a.vis.sit = k;
    if (a.phaseT < a.phaseDur) return;
    a.x = a.to.x;
    a.z = a.to.z;
    a.vis.sit = 1;
    a.yaw = a.toYaw;
    a.phase = "desk";
    a.idleFor = 0;
    // voltou da caminhada para descansar na mesa: fica um tempo antes de passear de novo
    if (!a.mustWork) a.leaveDelay = 10 + this.rng() * 30;
  }

  private stepStanding(a: Actor, dt: number) {
    a.yaw += angleDelta(a.yaw, a.toYaw) * (1 - Math.exp(-8 * dt));
    a.phaseT += dt;
    a.dwell -= dt;
    if (a.dwell > 0) return;
    // fim da parada: outro ponto do átrio ou de volta à mesa (a reserva antiga é solta pelo `choose`)
    a.intent = this.choose(a);
    a.activity = this.activityFor(a.intent);
    this.beginWalk(a);
  }

  /** Altura do piso em (x, z): átrio, rampas e alas têm níveis diferentes. */
  levelAt(x: number, z: number): number {
    return this.world?.levelAt(x, z) ?? 0;
  }


  // ---------------------------------------------------------------------------
  // Visual (suavizado) — é isso que o rig lê
  // ---------------------------------------------------------------------------

  private updateVisual(a: Actor, dt: number) {
    const v = a.vis;
    const moving = a.phase === "walking";
    v.walk = damp(v.walk, moving ? clamp01(a.speed / (WALK_SPEED * 0.9)) : 0, 8, dt);
    if (a.phase === "desk") {
      v.sit = 1;
      v.work = damp(v.work, a.working ? 1 : 0, 6, dt);
    } else {
      v.work = damp(v.work, 0, 8, dt);
    }
    if (a.phase === "walking" || a.phase === "standing") v.sit = 0;
  }

  // ---------------------------------------------------------------------------
  // Consulta (UI e testes)
  // ---------------------------------------------------------------------------

  occupancy(): Map<string, string> {
    return new Map(this.reservations);
  }
}
