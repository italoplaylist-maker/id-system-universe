import { angleDelta, dist, forward, makeRng, type Vec2 } from "./geometry";
import type { ChatPair, SeatKind, SeatSpot, StandSpot } from "./lounge-layout";
import type { DeskInfo, LifeWorld } from "./world";

/**
 * Simulação VISUAL da vida dos agentes. Lê o estado real (precisa trabalhar? está digitando?)
 * e decide onde cada personagem fica e o que faz — nunca escreve nada de volta no sistema.
 * Peças: fases (desk/rising/walking/sitting/seated/standing), reservas de lugares, A* na malha
 * do mundo, desvio entre personagens e recuperação de travamentos.
 */

export type Phase = "desk" | "rising" | "walking" | "sitting" | "seated" | "standing";
export type Activity = "working" | "going_to_work" | "resting" | "pool" | "chatting" | "bar" | "walking" | "wandering";

export type Intent =
  | { kind: "work" }
  | { kind: "seat"; seat: SeatSpot }
  | { kind: "pool"; spot: StandSpot }
  | { kind: "chat"; pair: ChatPair; side: "a" | "b" }
  | { kind: "wander"; point: Vec2; key: string | null };

/** O que o rig do personagem lê a cada frame (valores já suavizados). */
export interface ActorVisual {
  gait: number;
  walk: number;
  sit: number;
  seatKind: SeatKind | "desk";
  hipSeat: number;
  backLean: number;
  work: number;
  talk: number;
  drink: number;
  pool: number;
  stroke: number;
  glass: boolean;
  cue: boolean;
  lookYaw: number;
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
  /** Reserva anterior mantida até terminar de levantar (ninguém senta antes de eu sair). */
  holdKey: string | null;
  seat: SeatSpot | null;
  lastKind: string;
  wanderStreak: number;
  stuckT: number;
  stuckRef: Vec2;
  stuckCount: number;
  recoveries: number;
  drinkT: number;
  waitT: number;
  leaveAt: number;
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
  return { gait: 0, walk: 0, sit: 1, seatKind: "desk", hipSeat: 0.5, backLean: 0, work: 0, talk: 0, drink: 0, pool: 0, stroke: 0, glass: false, cue: false, lookYaw: 0 };
}

interface PoolState {
  shooter: string | null;
  stage: "wait" | "aim" | "stroke" | "follow";
  t: number;
  dur: number;
  lastShot: Map<string, number>;
  shotToken: number;
  shotBy: string | null;
}

interface ChatState {
  speaker: "a" | "b";
  t: number;
  dwell: number | null;
}

export class LifeSim {
  readonly actors = new Map<string, Actor>();
  private world: LifeWorld | null = null;
  private rng: () => number;
  private reservations = new Map<string, string>();
  private pool: PoolState = { shooter: null, stage: "wait", t: 0, dur: 1, lastShot: new Map(), shotToken: 0, shotBy: null };
  private chats = new Map<string, ChatState>();
  private visuals = new Map<string, ActorVisual>();
  time = 0;

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

  get poolShot(): { token: number; by: string | null } {
    return { token: this.pool.shotToken, by: this.pool.shotBy };
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
      // O layout mudou sob os pés: quem está parado em um lugar acompanha o móvel; quem anda replaneja.
      if (a.phase === "desk" || (a.phase === "sitting" && a.intent.kind === "work")) {
        a.x = a.desk.seat.x;
        a.z = a.desk.seat.z;
        a.to = a.desk.seat;
      } else if (a.phase === "seated" || a.phase === "standing") {
        const spot = this.spotFor(a);
        if (spot) {
          a.x = spot.x;
          a.z = spot.z;
        }
      } else if (a.phase === "walking") {
        this.replan(a);
      }
      if (a.phase !== "desk" && a.phase !== "walking" && a.phase !== "rising" && a.phase !== "sitting" && !world.grid.isFree(a.x, a.z) && a.phase !== "seated" && a.phase !== "standing") {
        const p = world.grid.nearestFree(a.x, a.z);
        if (p) {
          a.x = p.x;
          a.z = p.z;
        }
      }
    }
  }

  /** Sincroniza com o estado real: cria quem apareceu, remove quem sumiu (offline), atualiza prioridades. */
  sync(inputs: SyncInput[]) {
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
      holdKey: null,
      seat: null,
      lastKind: "work",
      wanderStreak: 0,
      stuckT: 0,
      stuckRef: { x: desk.seat.x, z: desk.seat.z },
      stuckCount: 0,
      recoveries: 0,
      drinkT: 0,
      waitT: 0,
      leaveAt: 0,
      holdT: 0,
      retreating: false,
      replanT: 0,
    };
  }

  private remove(id: string) {
    const a = this.actors.get(id);
    if (a) {
      this.release(a);
      this.dropHold(a);
    }
    this.actors.delete(id);
    this.visuals.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Reservas (ninguém senta onde outro já está)
  // ---------------------------------------------------------------------------

  private claim(key: string, a: Actor): boolean {
    const holder = this.reservations.get(key);
    if (holder && holder !== a.id && this.actors.has(holder)) return false;
    this.reservations.set(key, a.id);
    a.reservation = key;
    return true;
  }

  private release(a: Actor) {
    if (a.reservation && this.reservations.get(a.reservation) === a.id) this.reservations.delete(a.reservation);
    a.reservation = null;
    a.seat = null;
  }

  private dropHold(a: Actor) {
    if (a.holdKey && this.reservations.get(a.holdKey) === a.id) this.reservations.delete(a.holdKey);
    a.holdKey = null;
  }

  private isTaken(key: string): boolean {
    const holder = this.reservations.get(key);
    return !!holder && this.actors.has(holder);
  }

  private spotFor(a: Actor): Vec2 | null {
    if (a.intent.kind === "seat") return a.intent.seat.pos;
    if (a.intent.kind === "pool") return a.intent.spot.pos;
    if (a.intent.kind === "chat") return a.intent.pair[a.intent.side].pos;
    if (a.intent.kind === "wander") return a.intent.point;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Decisão: o que fazer quando está livre
  // ---------------------------------------------------------------------------

  /** Escolhe a próxima atividade livre; null = o lounge está lotado agora (o personagem fica onde está e tenta de novo). */
  private decide(a: Actor): Intent | null {
    const world = this.world!;
    const lounge = world.lounge;
    const options: Array<{ weight: number; make: () => Intent | null; kind: string }> = [];
    const freeSeats = (kind: SeatKind) => lounge.seats.filter((s) => s.kind === kind && !this.isTaken(s.id));
    const pick = <T>(list: T[]): T => list[Math.floor(this.rng() * list.length)];
    const penalty = (kind: string) => (a.lastKind === kind ? 0.3 : 1);

    const sofas = freeSeats("sofa");
    if (sofas.length) options.push({ kind: "sofa", weight: 3 * penalty("sofa"), make: () => ({ kind: "seat", seat: pick(sofas) }) });
    const arms = freeSeats("armchair");
    if (arms.length) options.push({ kind: "armchair", weight: 1.6 * penalty("armchair"), make: () => ({ kind: "seat", seat: pick(arms) }) });
    const stools = freeSeats("stool");
    if (stools.length) options.push({ kind: "stool", weight: 2.6 * penalty("stool"), make: () => ({ kind: "seat", seat: pick(stools) }) });

    const poolFree = lounge.poolSpots.filter((s) => !this.isTaken(s.id));
    if (poolFree.length) {
      const someonePlays = lounge.poolSpots.some((s) => this.isTaken(s.id));
      options.push({ kind: "pool", weight: (someonePlays ? 4 : 2.2) * penalty("pool"), make: () => ({ kind: "pool", spot: pick(poolFree) }) });
    }

    // Conversa: prefere juntar-se a quem já espera um parceiro.
    const waiting = lounge.chatPairs.find((p) => this.isTaken(`${p.id}-a`) !== this.isTaken(`${p.id}-b`));
    if (waiting) {
      const side: "a" | "b" = this.isTaken(`${waiting.id}-a`) ? "b" : "a";
      options.push({ kind: "chat", weight: 5 * penalty("chat"), make: () => ({ kind: "chat", pair: waiting, side }) });
    } else {
      const open = lounge.chatPairs.filter((p) => !this.isTaken(`${p.id}-a`) && !this.isTaken(`${p.id}-b`));
      if (open.length) options.push({ kind: "chat", weight: 1.2 * penalty("chat"), make: () => ({ kind: "chat", pair: pick(open), side: this.rng() < 0.5 ? "a" : "b" }) });
    }

    const wanderFree = lounge.wander.map((p, i) => ({ p, key: `wander-${i}` })).filter((w) => !this.isTaken(w.key));
    if (a.wanderStreak < 2 && wanderFree.length) {
      options.push({ kind: "wander", weight: 0.9, make: () => { const w = pick(wanderFree); return { kind: "wander", point: w.p, key: w.key }; } });
    }

    let total = options.reduce((s, o) => s + o.weight, 0);
    for (let tries = 0; tries < 6 && options.length > 0; tries += 1) {
      let r = this.rng() * total;
      let chosen = options[options.length - 1];
      for (const o of options) {
        r -= o.weight;
        if (r <= 0) {
          chosen = o;
          break;
        }
      }
      const intent = chosen.make();
      if (!intent) continue;
      if (this.reserve(a, intent)) {
        a.lastKind = chosen.kind;
        a.wanderStreak = intent.kind === "wander" ? a.wanderStreak + 1 : 0;
        return intent;
      }
      options.splice(options.indexOf(chosen), 1);
      total = options.reduce((s, o) => s + o.weight, 0);
    }
    return null;
  }

  private reserve(a: Actor, intent: Intent): boolean {
    switch (intent.kind) {
      case "seat":
        return this.claim(intent.seat.id, a);
      case "pool":
        return this.claim(intent.spot.id, a);
      case "chat":
        return this.claim(`${intent.pair.id}-${intent.side}`, a);
      case "wander":
        return intent.key ? this.claim(intent.key, a) : (a.reservation = null, true);
      default:
        a.reservation = null;
        return true;
    }
  }

  private activityFor(intent: Intent): Activity {
    switch (intent.kind) {
      case "seat":
        return intent.seat.kind === "stool" ? "bar" : "resting";
      case "pool":
        return "pool";
      case "chat":
        return "chatting";
      case "wander":
        return "wandering";
      default:
        return "going_to_work";
    }
  }

  // ---------------------------------------------------------------------------
  // Interrupção: chegou trabalho de verdade
  // ---------------------------------------------------------------------------

  private interruptForWork(a: Actor) {
    const wasSeat = a.seat;
    const previous = a.intent;
    this.release(a);
    this.dropHold(a);
    a.intent = { kind: "work" };
    a.activity = a.phase === "desk" ? "working" : "going_to_work";
    a.lastKind = "work";
    a.wanderStreak = 0;
    switch (a.phase) {
      case "desk":
        return;
      case "sitting":
        // Sentando na mesa: segue. Sentando em outro lugar: desfaz o movimento levantando.
        if (previous.kind === "work") return;
        this.startRising(a, wasSeat?.approach ?? this.approachFromHere(a));
        return;
      case "seated":
        this.startRising(a, wasSeat?.approach ?? this.approachFromHere(a));
        return;
      case "rising":
        // já levantando: ao terminar, segue para a mesa
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
      this.stepPool(dt);
      this.stepChats(dt);
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
      case "seated":
        this.stepSeated(a, dt);
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
      const next = this.decide(a);
      if (!next) {
        a.leaveDelay = 4 + this.rng() * 8; // lounge lotado: tenta de novo daqui a pouco
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
    this.dropHold(a);
    a.seat = null;
    if (a.mustWork) {
      a.intent = { kind: "work" };
    } else if (a.intent.kind === "work") {
      a.intent = this.decide(a) ?? { kind: "wander", point: this.world!.lounge.wander[0], key: null };
    } else if ((a.intent.kind === "seat" || a.intent.kind === "pool" || a.intent.kind === "chat" || (a.intent.kind === "wander" && a.intent.key)) && !this.reservedBy(a)) {
      // a reserva foi feita antes de levantar; se algo a tomou, escolhe de novo
      a.intent = this.decide(a) ?? { kind: "wander", point: this.world!.lounge.wander[0], key: null };
    }
    a.activity = this.activityFor(a.intent);
    this.beginWalk(a);
  }

  private reservedBy(a: Actor): boolean {
    return !!a.reservation && this.reservations.get(a.reservation) === a.id;
  }

  private goalFor(a: Actor): Vec2 {
    switch (a.intent.kind) {
      case "work":
        return a.desk.approach;
      case "seat":
        return a.intent.seat.approach;
      case "pool":
        return a.intent.spot.pos;
      case "chat":
        return a.intent.pair[a.intent.side].pos;
      case "wander":
        return a.intent.point;
    }
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
          const p = world.grid.nearestFree(a.x, a.z, 2.5);
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

  /** Alguém parou (conversa, sinuca, sentou) em cima do caminho que eu planejei: contorna. */
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
    switch (a.intent.kind) {
      case "work":
        this.startSitting(a, a.desk.seat, a.desk.yaw, "desk", 0.5, 0.1);
        return;
      case "seat": {
        const s = a.intent.seat;
        a.seat = s;
        this.startSitting(a, s.pos, s.yaw, s.kind, s.hipSeat, s.backLean);
        return;
      }
      case "pool":
      case "chat":
      case "wander": {
        a.phase = "standing";
        a.phaseT = 0;
        a.toYaw = a.intent.kind === "pool" ? a.intent.spot.yaw : a.intent.kind === "chat" ? a.intent.pair[a.intent.side].yaw : a.yaw;
        a.dwell = this.dwellFor(a);
        a.waitT = 0;
        return;
      }
    }
  }

  private dwellFor(a: Actor): number {
    const r = this.rng();
    switch (a.intent.kind) {
      case "pool":
        return 40 + r * 40;
      case "chat":
        return 20 + r * 20;
      case "wander":
        return 4 + r * 4;
      case "seat":
        return a.intent.seat.kind === "stool" ? 30 + r * 40 : a.intent.seat.kind === "armchair" ? 25 + r * 30 : 25 + r * 35;
      default:
        return 10;
    }
  }

  private startSitting(a: Actor, to: Vec2, yaw: number, kind: SeatKind | "desk", hipSeat: number, backLean: number) {
    a.phase = "sitting";
    a.phaseT = 0;
    a.phaseDur = SIT_DUR;
    a.from = { x: a.x, z: a.z };
    a.to = to;
    a.toYaw = yaw;
    a.vis.seatKind = kind;
    a.vis.hipSeat = hipSeat;
    a.vis.backLean = backLean;
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
    if (a.intent.kind === "work") {
      a.phase = "desk";
      a.idleFor = 0;
    } else {
      a.phase = "seated";
      a.dwell = this.dwellFor(a);
      a.drinkT = 2 + this.rng() * 8;
    }
  }

  private stepSeated(a: Actor, dt: number) {
    a.dwell -= dt;
    if (a.seat?.kind === "stool") {
      a.drinkT -= dt;
      if (a.drinkT < -3.4) a.drinkT = 8 + this.rng() * 8;
    }
    if (a.dwell <= 0) {
      const approach = a.seat?.approach ?? this.approachFromHere(a);
      const previousSeat = a.reservation;
      const next = this.decide(a);
      if (!next) {
        a.dwell = 6 + this.rng() * 10; // sem alternativa livre: fica mais um pouco
        return;
      }
      a.intent = next;
      // `decide` reserva o novo lugar; o antigo fica retido até terminar de levantar.
      if (previousSeat && a.reservation !== previousSeat) a.holdKey = previousSeat;
      a.activity = this.activityFor(a.intent);
      this.startRising(a, approach);
    }
  }

  private stepStanding(a: Actor, dt: number) {
    a.yaw += angleDelta(a.yaw, a.toYaw) * (1 - Math.exp(-8 * dt));
    a.phaseT += dt;
    a.dwell -= dt;
    const leave = () => {
      const previous = a.reservation;
      const next = this.decide(a);
      if (!next) {
        a.dwell = 6 + this.rng() * 10;
        a.leaveAt = 0;
        a.waitT = 0;
        return;
      }
      a.intent = next;
      if (previous && this.reservations.get(previous) === a.id && a.reservation !== previous) this.reservations.delete(previous);
      a.activity = this.activityFor(a.intent);
      this.beginWalk(a);
    };
    if (a.intent.kind === "chat") {
      const pair = a.intent.pair;
      const partnerKey = `${pair.id}-${a.intent.side === "a" ? "b" : "a"}`;
      const partner = this.actors.get(this.reservations.get(partnerKey) ?? "");
      const partnerHere = !!partner && partner.phase === "standing" && partner.arrived;
      const st = this.chats.get(pair.id) ?? { speaker: "a" as const, t: 0, dwell: null };
      this.chats.set(pair.id, st);
      if (partnerHere) {
        a.waitT = 0;
        if (st.dwell === null) {
          st.dwell = 18 + this.rng() * 22;
          a.leaveAt = this.time + st.dwell + this.rng() * 1.2;
        } else if (!a.leaveAt) a.leaveAt = this.time + Math.max(0.5, st.dwell - st.t) + this.rng() * 1.2;
        if (this.time >= a.leaveAt) {
          a.leaveAt = 0;
          leave();
        }
      } else {
        const ended = a.leaveAt > 0;
        a.waitT += dt;
        a.leaveAt = 0;
        st.dwell = null;
        st.t = 0;
        if (ended || a.waitT > 14) leave();
      }
      return;
    }
    if (a.dwell <= 0) leave();
  }

  // ---------------------------------------------------------------------------
  // Sinuca e conversas (estado compartilhado entre os participantes)
  // ---------------------------------------------------------------------------

  private poolPlayers(): Actor[] {
    const out: Actor[] = [];
    for (const a of this.actors.values()) if (a.phase === "standing" && a.arrived && a.intent.kind === "pool") out.push(a);
    return out;
  }

  private stepPool(dt: number) {
    const p = this.pool;
    const players = this.poolPlayers();
    if (players.length === 0) {
      p.shooter = null;
      p.stage = "wait";
      p.t = 0;
      return;
    }
    p.t += dt;
    if (p.shooter && !players.some((x) => x.id === p.shooter)) {
      p.shooter = null;
      p.stage = "wait";
      p.t = 0;
    }
    if (p.stage === "wait" && p.t >= 1.2) {
      // Quem atirou há mais tempo joga agora.
      players.sort((x, y) => (p.lastShot.get(x.id) ?? -1) - (p.lastShot.get(y.id) ?? -1));
      p.shooter = players[0].id;
      p.stage = "aim";
      p.t = 0;
      p.dur = 1.8 + this.rng() * 0.8;
    } else if (p.stage === "aim" && p.t >= p.dur) {
      p.stage = "stroke";
      p.t = 0;
      p.dur = 0.55;
      p.shotToken += 1;
      p.shotBy = p.shooter;
      if (p.shooter) p.lastShot.set(p.shooter, this.time);
    } else if (p.stage === "stroke" && p.t >= p.dur) {
      p.stage = "follow";
      p.t = 0;
      p.dur = 3 + this.rng() * 1.5;
    } else if (p.stage === "follow" && p.t >= p.dur) {
      p.stage = "wait";
      p.t = 0;
      p.shooter = null;
    }
  }

  private stepChats(dt: number) {
    for (const [id, st] of this.chats) {
      const a = this.actors.get(this.reservations.get(`${id}-a`) ?? "");
      const b = this.actors.get(this.reservations.get(`${id}-b`) ?? "");
      if (!a && !b) {
        this.chats.delete(id);
        continue;
      }
      st.t += dt;
      if (st.t > 2.4 + (st.speaker === "a" ? 2.6 : 1.8)) {
        st.speaker = st.speaker === "a" ? "b" : "a";
        st.t = 0;
      }
    }
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
    if (a.phase === "seated") v.sit = 1;

    const standingPool = a.phase === "standing" && a.intent.kind === "pool" && a.arrived;
    const isShooter = standingPool && this.pool.shooter === a.id;
    let poolTarget = 0;
    let stroke = 0;
    if (isShooter) {
      poolTarget = 1;
      if (this.pool.stage === "stroke") stroke = clamp01(this.pool.t / this.pool.dur);
      else if (this.pool.stage === "aim") stroke = 0;
      else stroke = 1;
    }
    v.pool = damp(v.pool, poolTarget, 6, dt);
    v.stroke = damp(v.stroke, this.pool.stage === "aim" ? Math.sin(this.time * 7) * 0.18 + 0.2 : stroke, 14, dt);
    v.cue = standingPool;

    // conversa
    let talk = 0;
    let look = 0;
    if (a.phase === "standing" && a.intent.kind === "chat" && a.arrived) {
      const st = this.chats.get(a.intent.pair.id);
      const other = this.actors.get(this.reservations.get(`${a.intent.pair.id}-${a.intent.side === "a" ? "b" : "a"}`) ?? "");
      if (st && other && other.phase === "standing" && other.arrived) {
        talk = st.speaker === a.intent.side ? 1 : 0.3;
        look = Math.sin(this.time * 0.9 + a.seed) * 0.15;
      }
    }
    v.talk = damp(v.talk, talk, 5, dt);
    v.lookYaw = damp(v.lookYaw, look, 4, dt);

    // bebida no bar
    let drink = 0;
    if (a.phase === "seated" && a.seat?.kind === "stool" && a.drinkT < 0) {
      const t = -a.drinkT;
      drink = t < 1.2 ? ease(t / 1.2) : t < 2.1 ? 1 : ease(clamp01(1 - (t - 2.1) / 1.2));
    }
    v.drink = damp(v.drink, drink, 12, dt);
    v.glass = a.phase === "seated" && a.seat?.kind === "stool";
  }

  // ---------------------------------------------------------------------------
  // Consulta (UI e testes)
  // ---------------------------------------------------------------------------

  occupancy(): Map<string, string> {
    return new Map(this.reservations);
  }
}
