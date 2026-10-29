import type { UniverseProject, UniverseProviderSummary } from "@/types/domain";

/** One big open-plan office: a row-and-column grid of project desks facing the Central de Comando
    screen on the back wall, a lounge/reception strip along the (open) front, server racks beside
    the screen. Pure data — everything that positions something in the office reads from here. */
export const OFFICE = {
  WALL_HEIGHT: 3.9,
  WALL_THICKNESS: 0.18,
  SLOT_X: 3.0,
  SLOT_Z: 3.0,
  /** Free space between the back wall and the first desk row (the screen + walkway). */
  BACK_ZONE: 3.3,
  /** Free space between the last desk row and the open front edge (lounge + reception). */
  FRONT_ZONE: 3.6,
  SIDE_MARGIN: 1.7,
  MIN_WIDTH: 15,
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
  return Math.max(3, Math.min(8, Math.round(Math.sqrt(Math.max(count, 1) * 1.8))));
}

export function computeOfficeLayout(projects: UniverseProject[], providers: UniverseProviderSummary[]): OfficeLayout {
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const count = sorted.length;
  const cols = columnsFor(count);
  const rows = Math.max(1, Math.ceil(count / cols));

  const width = Math.max(OFFICE.MIN_WIDTH, cols * OFFICE.SLOT_X + OFFICE.SIDE_MARGIN * 2);
  const depth = OFFICE.BACK_ZONE + rows * OFFICE.SLOT_Z + OFFICE.FRONT_ZONE;
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
  const screenWidth = Math.min(10.4, width - 7);
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
