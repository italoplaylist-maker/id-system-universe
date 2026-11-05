import type { Obstacle, Vec2 } from "./geometry";

/** Heap binário mínimo (min-heap por prioridade) para o A*. */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}

export interface GridBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Grade de ocupação para navegação: células bloqueadas (paredes, móveis) e uma versão inflada
 * pelo raio do personagem — o A* só pisa em células da versão inflada, então o corpo nunca
 * encosta em móvel ou parede. Caminhos são suavizados por linha de visão.
 */
export class NavGrid {
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly nx: number;
  readonly nz: number;
  private raw: Uint8Array;
  private inflated: Uint8Array;
  /** Células "apertadas" (perto demais de móvel/parede): transitáveis, mas o A* prefere corredores largos. */
  private tight: Uint8Array;

  constructor(bounds: GridBounds, cell = 0.15) {
    this.cell = cell;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.raw = new Uint8Array(this.nx * this.nz).fill(1);
    this.inflated = new Uint8Array(this.nx * this.nz).fill(1);
    this.tight = new Uint8Array(this.nx * this.nz);
  }

  private ix(x: number) {
    return Math.floor((x - this.minX) / this.cell);
  }
  private iz(z: number) {
    return Math.floor((z - this.minZ) / this.cell);
  }
  private inside(ix: number, iz: number) {
    return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz;
  }
  private center(ix: number, iz: number): Vec2 {
    return { x: this.minX + (ix + 0.5) * this.cell, z: this.minZ + (iz + 0.5) * this.cell };
  }

  /** Marca/limpa um retângulo: vale para as células cujo CENTRO está dentro (parede fina nunca some por alinhamento). */
  setRect(minX: number, maxX: number, minZ: number, maxZ: number, blocked: boolean) {
    const x0 = Math.max(0, Math.ceil((minX - this.minX) / this.cell - 0.5));
    const x1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / this.cell - 0.5));
    const z0 = Math.max(0, Math.ceil((minZ - this.minZ) / this.cell - 0.5));
    const z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / this.cell - 0.5));
    for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) this.raw[z * this.nx + x] = blocked ? 1 : 0;
  }

  setCircle(cx: number, cz: number, r: number, blocked: boolean) {
    const x0 = Math.max(0, this.ix(cx - r));
    const x1 = Math.min(this.nx - 1, this.ix(cx + r));
    const z0 = Math.max(0, this.iz(cz - r));
    const z1 = Math.min(this.nz - 1, this.iz(cz + r));
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const c = this.center(x, z);
        if (Math.hypot(c.x - cx, c.z - cz) <= r) this.raw[z * this.nx + x] = blocked ? 1 : 0;
      }
    }
  }

  setObstacle(o: Obstacle) {
    if (o.kind === "rect") this.setRect(o.minX, o.maxX, o.minZ, o.maxZ, true);
    else this.setCircle(o.cx, o.cz, o.r, true);
  }

  private dilate(radius: number): Uint8Array {
    const out = new Uint8Array(this.nx * this.nz);
    const r = Math.ceil(radius / this.cell);
    const r2 = (radius / this.cell) ** 2;
    for (let z = 0; z < this.nz; z += 1) {
      for (let x = 0; x < this.nx; x += 1) {
        if (!this.raw[z * this.nx + x]) continue;
        for (let dz = -r; dz <= r; dz += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (dx * dx + dz * dz > r2) continue;
            const nx = x + dx;
            const nz = z + dz;
            if (this.inside(nx, nz)) out[nz * this.nx + nx] = 1;
          }
        }
      }
    }
    return out;
  }

  /** Calcula a grade inflada pelo raio do corpo e a de "corredores apertados". Chamar depois de montar o mundo. */
  finalize(radius: number, comfortExtra = 0.34) {
    this.inflated = this.dilate(radius);
    this.tight = this.dilate(radius + comfortExtra);
  }

  /** Há espaço para dois personagens se cruzarem neste ponto? */
  isRoomy(x: number, z: number): boolean {
    const ix = this.ix(x);
    const iz = this.iz(z);
    return this.inside(ix, iz) && !this.tight[iz * this.nx + ix];
  }

  /** Livre para o CENTRO do corpo (já considera o raio). */
  isFree(x: number, z: number): boolean {
    const ix = this.ix(x);
    const iz = this.iz(z);
    return this.inside(ix, iz) && !this.inflated[iz * this.nx + ix];
  }

  /** Dentro de parede/móvel de fato (sem folga): o único caso em que o corpo atravessaria algo. */
  isSolid(x: number, z: number): boolean {
    const ix = this.ix(x);
    const iz = this.iz(z);
    return !this.inside(ix, iz) || !!this.raw[iz * this.nx + ix];
  }

  nearestFree(x: number, z: number, maxRadius = 3): Vec2 | null {
    if (this.isFree(x, z)) return { x, z };
    const ix0 = this.ix(x);
    const iz0 = this.iz(z);
    const maxR = Math.ceil(maxRadius / this.cell);
    for (let r = 1; r <= maxR; r += 1) {
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ix = ix0 + dx;
          const iz = iz0 + dz;
          if (!this.inside(ix, iz) || this.inflated[iz * this.nx + ix]) continue;
          const c = this.center(ix, iz);
          const d = Math.hypot(c.x - x, c.z - z);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  lineOfSight(a: Vec2, b: Vec2, extra?: Uint8Array): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const ix = this.ix(x);
      const iz = this.iz(z);
      if (!this.inside(ix, iz) || this.inflated[iz * this.nx + ix]) return false;
      if (extra && extra[iz * this.nx + ix]) return false;
    }
    return true;
  }

  /**
   * Caminho de `from` até `to` (A* 8-vizinhos, sem cortar quina). `blockers` são outros
   * personagens parados: viram obstáculos temporários (raio `blockerRadius`).
   * Retorna os pontos a visitar (sem o ponto de partida) ou null se não houver caminho.
   */
  findPath(from: Vec2, to: Vec2, blockers: Vec2[] = [], blockerRadius = 0.42): Vec2[] | null {
    const start = this.nearestFree(from.x, from.z, 1.2);
    const goal = this.nearestFree(to.x, to.z, 1.2);
    if (!start || !goal) return null;

    let extra: Uint8Array | undefined;
    if (blockers.length > 0) {
      extra = new Uint8Array(this.nx * this.nz);
      const r = Math.ceil(blockerRadius / this.cell);
      for (const b of blockers) {
        const bx = this.ix(b.x);
        const bz = this.iz(b.z);
        for (let dz = -r; dz <= r; dz += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (dx * dx + dz * dz > r * r) continue;
            if (this.inside(bx + dx, bz + dz)) extra[(bz + dz) * this.nx + bx + dx] = 1;
          }
        }
      }
    }
    const sIdx = this.iz(start.z) * this.nx + this.ix(start.x);
    const gIdx = this.iz(goal.z) * this.nx + this.ix(goal.x);
    const blocked = (i: number) => (i === sIdx || i === gIdx ? false : !!this.inflated[i] || !!(extra && extra[i]));

    const n = this.nx * this.nz;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gx = gIdx % this.nx;
    const gz = (gIdx / this.nx) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % this.nx) - gx);
      const dz = Math.abs(((i / this.nx) | 0) - gz);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    g[sIdx] = 0;
    heap.push(sIdx, h(sIdx));
    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === gIdx) {
        found = true;
        break;
      }
      const cx = cur % this.nx;
      const cz = (cur / this.nx) | 0;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inside(nx, nz)) continue;
          const ni = nz * this.nx + nx;
          if (closed[ni] || blocked(ni)) continue;
          if (dx !== 0 && dz !== 0 && (blocked(cz * this.nx + nx) || blocked(nz * this.nx + cx))) continue;
          const cost = g[cur] + (dx !== 0 && dz !== 0 ? 1.4142 : 1) * (this.tight[ni] ? 3 : 1);
          if (cost < g[ni]) {
            g[ni] = cost;
            came[ni] = cur;
            heap.push(ni, cost + h(ni));
          }
        }
      }
    }
    if (!found) return null;

    const raw: Vec2[] = [];
    for (let i = gIdx; i !== -1 && i !== sIdx; i = came[i]) raw.push(this.center(i % this.nx, (i / this.nx) | 0));
    raw.reverse();
    // O último ponto é o destino exato pedido (se ele próprio é livre), não o centro da célula.
    if (this.isFree(to.x, to.z)) raw.push({ x: to.x, z: to.z });
    else raw.push(goal);

    // Suavização: pula pontos intermediários enquanto houver linha de visão livre.
    const out: Vec2[] = [];
    let anchor: Vec2 = start;
    let i = 0;
    while (i < raw.length) {
      let j = raw.length - 1;
      while (j > i && !this.lineOfSight(anchor, raw[j], extra)) j -= 1;
      out.push(raw[j]);
      anchor = raw[j];
      i = j + 1;
    }
    return out;
  }
}
