import type { UniverseProject, UniverseProviderSummary } from "@/types/domain";

/** One big open-plan office: a row-and-column grid of project desks facing the Central de Comando
    screen on the back wall, a lounge/reception strip along the (open) front, server racks beside
    the screen. Pure data — everything that positions something in the office reads from here. */
export const OFFICE = {
  WALL_HEIGHT: 3.9,
  WALL_THICKNESS: 0.18,
  SLOT_X: 2.5,
  SLOT_Z: 2.6,
  /** Free space between the back wall and the first desk row (the screen + walkway). */
  BACK_ZONE: 3.0,
  /** Free space between the last desk row and the open front edge (lounge + reception). */
  FRONT_ZONE: 2.3,
  SIDE_MARGIN: 0.95,
  MIN_WIDTH: 12.5,
} as const;

export interface DeskSlot {
  projectId: string;
  name: string;
  accent: string;
  /** Center of the desk pod on the floor. */
  x: number;
  z: number;
  row: number;
  col: number;
  /** Rotação extra da mesa em torno do assento (rad, convenção three.js), além da orientação padrão (olhando para −z). Mesas em agrupamentos giram. */
  yaw?: number;
}

export interface RackSlot {
  providerId: string;
  name: string;
  color: string;
  x: number;
  z: number;
}

export interface OfficeLayout {
  width: number;
  depth: number;
  /** Everything is centered on x=0; z runs from -depth/2 (back wall) to +depth/2 (open front). */
  desks: DeskSlot[];
  racks: RackSlot[];
  screen: { width: number; height: number; y: number; z: number };
  /** Trecho da parede oeste reservado à parede do NOC (z de início/fim, comprimento). */
  noc: { z0: number; z1: number; length: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  center: [number, number, number];
  radius: number;
  cols: number;
  rows: number;
}

export const SCREEN_CANVAS = { width: 2048, height: 410 } as const;

/** Columns grow with the square root of the project count so the room stays roughly 3:2 instead of one endless row. */
function columnsFor(count: number): number {
  return Math.max(3, Math.min(7, Math.round(Math.sqrt(Math.max(count, 1) * 1.1))));
}

export function computeOfficeLayout(projects: Pick<UniverseProject, "id" | "name" | "accent">[], providers: Pick<UniverseProviderSummary, "id" | "name" | "color">[], options: { minWidth?: number; minDepth?: number; keepOrder?: boolean } = {}): OfficeLayout {
  // keepOrder: a sala dos agentes mantém a ordem recebida (cada agente tem a sua mesa); só os projetos vão em ordem alfabética.
  const sorted = options.keepOrder ? [...projects] : [...projects].sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const count = sorted.length;
  const cols = columnsFor(count);
  const rows = Math.max(1, Math.ceil(count / cols));

  const width = Math.max(options.minWidth ?? OFFICE.MIN_WIDTH, cols * OFFICE.SLOT_X + OFFICE.SIDE_MARGIN * 2);
  const depth = Math.max(options.minDepth ?? 0, OFFICE.BACK_ZONE + rows * OFFICE.SLOT_Z + OFFICE.FRONT_ZONE);
  const backZ = -depth / 2;
  const firstRowZ = backZ + OFFICE.BACK_ZONE + OFFICE.SLOT_Z / 2;

  const desks: DeskSlot[] = sorted.map((project, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    // The last (partial) row is centered under the rows above it.
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const x = (col - (inRow - 1) / 2) * OFFICE.SLOT_X;
    return { projectId: project.id, name: project.name, accent: project.accent, x, z: firstRowZ + row * OFFICE.SLOT_Z, row, col };
  });

  // Racks stand against the back wall to the left of the screen, in a tidy row; overflow forms a second row in front.
  // Sem racks (ex.: sala dos agentes) o telão pode ocupar quase toda a parede.
  const screenWidth = Math.min(10.4, width - (providers.length > 0 ? 7 : 3));
  const rackZoneRight = -screenWidth / 2 - 0.9;
  const rackZoneLeft = -width / 2 + 1.1;
  const perRow = Math.max(1, Math.floor((rackZoneRight - rackZoneLeft) / 0.95));
  const racks: RackSlot[] = providers.map((provider, index) => {
    const rackRow = Math.floor(index / perRow);
    const rackCol = index % perRow;
    return { providerId: provider.id, name: provider.name, color: provider.color, x: rackZoneLeft + 0.5 + rackCol * 0.95, z: backZ + 0.7 + rackRow * 1.5 };
  });

  const nocLength = Math.min(7.2, depth - 4.5);
  const screenHeight = (screenWidth * SCREEN_CANVAS.height) / SCREEN_CANVAS.width;
  // Padded past the walls: foundation plinth, entrance steps, and a little air so nothing touches the viewport edge.
  const bounds = { minX: -width / 2 - 0.9, maxX: width / 2 + 0.9, minZ: backZ - 0.5, maxZ: depth / 2 + 1.9, minY: -0.3, maxY: OFFICE.WALL_HEIGHT + 0.5 };
  const center: [number, number, number] = [0, OFFICE.WALL_HEIGHT * 0.35, 0];
  const radius = Math.sqrt((width / 2) ** 2 + (depth / 2) ** 2 + (OFFICE.WALL_HEIGHT / 2) ** 2) + 2;

  return {
    width,
    depth,
    desks,
    racks,
    noc: { z0: backZ + 0.5, z1: backZ + 0.5 + nocLength, length: nocLength },
    screen: { width: screenWidth, height: screenHeight, y: 2.3, z: backZ + OFFICE.WALL_THICKNESS / 2 + 0.06 },
    bounds,
    center,
    radius,
    cols,
    rows,
  };
}

/** Agrupamento ("pod") de mesas da Ala Operacional. */
export const POD = {
  CELL: 5.6,
  AISLE: 2.8,
  BACK_ZONE: 2.6,
  FRONT_ZONE: 1.8,
  SIDE_MARGIN: 0.7,
  /** Assentos da mesma dupla ficam a ±SEAT_Z do centro do pod, voltados um para o outro (com vidro no meio). */
  SEAT_Z: 1.5,
  SEAT_X: 1.1,
} as const;

export interface PodInfo {
  /** Centro do pod no plano local da ala. */
  x: number;
  z: number;
  /** 0 = duplas de frente ao longo de z; π/2 = ao longo de x. */
  yaw: number;
  index: number;
}

export interface AgentPodLayout extends OfficeLayout {
  pods: PodInfo[];
  /** z local do corredor central (onde fica a porta voltada para o átrio). */
  aisleZ: number;
}

/**
 * Sala dos agentes em agrupamentos: pods de até 4 mesas (duplas de frente, divisória de vidro no
 * meio), alternando a orientação, dispostos em duas colunas dos dois lados de um corredor central
 * que termina na porta do átrio. A ordem dos agentes é preservada (cada um mantém a sua mesa).
 */
export function computeAgentPods(agents: Pick<UniverseProject, "id" | "name" | "accent">[]): AgentPodLayout {
  const n = agents.length;
  const podCount = Math.max(1, Math.ceil(n / 4));
  const rowsTotal = Math.ceil(podCount / 2);
  const south = Math.ceil(rowsTotal / 2);
  const north = Math.floor(rowsTotal / 2);
  const cols = podCount >= 2 ? 2 : 1;
  const width = POD.SIDE_MARGIN * 2 + POD.CELL * cols;
  const depth = POD.BACK_ZONE + north * POD.CELL + POD.AISLE + south * POD.CELL + POD.FRONT_ZONE;
  const aisleZ = -depth / 2 + POD.BACK_ZONE + north * POD.CELL + POD.AISLE / 2;

  const pods: PodInfo[] = [];
  for (let p = 0; p < podCount; p += 1) {
    const r = Math.floor(p / 2);
    const col = p % 2;
    const isSouth = r % 2 === 0;
    const k = isSouth ? r / 2 : (r - 1) / 2;
    const z = isSouth ? aisleZ + POD.AISLE / 2 + POD.CELL / 2 + k * POD.CELL : aisleZ - POD.AISLE / 2 - POD.CELL / 2 - k * POD.CELL;
    const x = cols === 1 ? 0 : (col === 0 ? -1 : 1) * (POD.CELL / 2);
    pods.push({ x, z, yaw: (p + r) % 2 === 0 ? 0 : Math.PI / 2, index: p });
  }

  // Posição relativa das 4 mesas do pod (orientação 0): [x, assento z, giro extra].
  const rel: Array<[number, number, number]> = [
    [-POD.SEAT_X, POD.SEAT_Z, 0],
    [POD.SEAT_X, POD.SEAT_Z, 0],
    [-POD.SEAT_X, -POD.SEAT_Z, Math.PI],
    [POD.SEAT_X, -POD.SEAT_Z, Math.PI],
  ];
  const desks: DeskSlot[] = agents.map((a, i) => {
    const pod = pods[Math.floor(i / 4)];
    const [rx, rz, ry] = rel[i % 4];
    const c = Math.cos(pod.yaw);
    const sn = Math.sin(pod.yaw);
    return {
      projectId: a.id,
      name: a.name,
      accent: a.accent,
      x: pod.x + rx * c + rz * sn,
      z: pod.z - rx * sn + rz * c,
      row: Math.floor(i / 4),
      col: i % 4,
      yaw: pod.yaw + ry,
    };
  });

  const base = computeOfficeLayout([], [], { minWidth: width, minDepth: depth });
  return { ...base, width, depth, desks, pods, aisleZ };
}
