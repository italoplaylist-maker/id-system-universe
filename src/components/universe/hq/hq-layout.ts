import type { UniverseProject, UniverseProviderSummary } from "@/types/domain";

export type RoomKind = "reception" | "project" | "command-center" | "operations" | "server-room";
export type RoomSize = "SMALL" | "MEDIUM" | "LARGE";
export type OpenSide = "north" | "south" | "east" | "west";

export interface RoomLayout {
  id: string;
  kind: RoomKind;
  projectId?: string;
  name: string;
  accent: string;
  size: RoomSize;
  /** Footprint center. x/z are on that floor's own ground plane; y is the floor's elevation. */
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  /** Point on the room's corridor-facing edge — the only "opening" in its walls. */
  doorPoint: [number, number];
  side: "left" | "right" | "center";
  /** Walls are skipped on these sides — the room's only openings. */
  openSides: OpenSide[];
  resourceCount: number;
  /** 0 = ground floor (Reception/Command Center/Operations/Server Room). 1+ = a stacked project floor. */
  floorIndex: number;
}

export interface CorridorFloor {
  /** The shared walking spine on this floor, flush to that floor's own rooms — x is always 0. */
  minZ: number;
  maxZ: number;
  width: number;
  y: number;
  floorIndex: number;
  label: string;
}

export interface FloorFootprint {
  floorIndex: number;
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface HqLayout {
  rooms: RoomLayout[];
  /** One entry per floor (ground + every stacked project floor), for the corridor floor strip. */
  corridors: CorridorFloor[];
  serverRacks: { providerId: string; name: string; color: string; x: number; z: number }[];
  corridorWalls: CorridorWallSegment[];
  corridorDoors: CorridorDoor[];
  /** Fixed (x,z) vertical alignment point shared by every floor — not a rendered structure,
      just what keeps cross-floor pathing on a single straight line through the stack. */
  elevator: { x: number; z: number; topY: number };
  /** One entry per floor, footprint sized to exactly that floor's own rooms+corridor —
      what a floor slab/ceiling should be clipped to, never the whole building's bounds. */
  floorFootprints: FloorFootprint[];
  floorCount: number;
  floorHeight: number;
  /** Real footprint of every room — the camera fits to this, never a magic constant (briefing: calculateWorldBounds). */
  bounds: WorldBounds;
  /** Center of `bounds` in 3D — what the overview camera looks at. */
  center: [number, number, number];
  /** Bounding radius derived from `bounds`, used to size the camera distance and ground plane/fog. */
  radius: number;
}

/** Real footprint of the whole building — every camera calculation starts here instead of a magic constant. */
function computeWorldBounds(rooms: RoomLayout[]): WorldBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x - room.width / 2);
    maxX = Math.max(maxX, room.x + room.width / 2);
    minZ = Math.min(minZ, room.z - room.depth / 2);
    maxZ = Math.max(maxZ, room.z + room.depth / 2);
    minY = Math.min(minY, room.y);
    maxY = Math.max(maxY, room.y + WALL_HEIGHT);
  }
  return { minX, maxX, minZ, maxZ, minY, maxY };
}

const CORRIDOR_WIDTH = 2.6;
const ROW_GAP = 1.5;
// The two project rooms on a floor sit right next to each other, separated only by this
// thin reveal — no open hallway between them (that read as a corridor shaft running down
// the middle of every floor, stacked all the way up the building).
const PROJECT_ROOM_GAP = 0.5;

export const WALL_HEIGHT = 1.3;
export const WALL_THICKNESS = 0.12;
const DOOR_WIDTH = 1.6;

/** Every floor's row of project rooms starts at this same z — the z-range before it
    (0..LANDING_DEPTH) is reserved on every floor as the elevator landing, so the shaft
    lines up at the exact same (x,z) all the way up the building. On the ground floor
    that reserved zone is where Reception physically stands. */
const LANDING_DEPTH = 3;
// Tight architectural-cutaway spacing: just enough for WALL_HEIGHT + a slab, not a gap that
// reads as disconnected floating platforms.
export const FLOOR_HEIGHT = 2;

export interface CorridorWallSegment {
  side: "left" | "right";
  y: number;
  z: number;
  length: number;
}

export interface CorridorDoor {
  side: "left" | "right";
  x: number;
  y: number;
  z: number;
  width: number;
  accent: string;
}

/**
 * Real hallway walls along both corridor edges of ONE floor, with a door-width gap cut
 * wherever a room actually opens onto that edge — so you walk down an enclosed corridor
 * and enter each room through a distinct doorway, instead of the whole room frontage
 * being open floor. Center rooms (Reception, Command Center, Operations, Server Room)
 * straddle the corridor spine itself and are wider than it, so both edges are left fully
 * open across their depth — the room's own walls take over as the corridor boundary
 * there. Walls only ever span [minZ, maxZ] — that floor's own rooms, flush, never a
 * shared nominal length that would run past the walls it's supposed to cap.
 */
function computeCorridorWallsAndDoors(rooms: RoomLayout[], minZ: number, maxZ: number, corridorWidth: number, y: number) {
  const walls: CorridorWallSegment[] = [];
  const doors: CorridorDoor[] = [];

  for (const side of ["left", "right"] as const) {
    const blocked: [number, number][] = [];
    for (const room of rooms) {
      if (room.side === "center") {
        blocked.push([room.z - room.depth / 2 - 0.05, room.z + room.depth / 2 + 0.05]);
      } else if (room.side === side) {
        const doorSpan = Math.min(DOOR_WIDTH, room.depth);
        blocked.push([room.z - doorSpan / 2, room.z + doorSpan / 2]);
        doors.push({ side, x: (side === "left" ? -1 : 1) * (corridorWidth / 2), y, z: room.z, width: doorSpan, accent: room.accent });
      }
    }
    blocked.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of blocked) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    let cursor = minZ;
    for (const [start, end] of merged) {
      if (start - cursor > 0.15) walls.push({ side, y, z: (cursor + start) / 2, length: start - cursor });
      cursor = Math.max(cursor, end);
    }
    if (maxZ - cursor > 0.15) walls.push({ side, y, z: (cursor + maxZ) / 2, length: maxZ - cursor });
  }

  return { walls, doors };
}

function roomSizeFor(resourceCount: number): { size: RoomSize; width: number; depth: number } {
  if (resourceCount <= 3) return { size: "SMALL", width: 5, depth: 4.5 };
  if (resourceCount <= 6) return { size: "MEDIUM", width: 6, depth: 5 };
  return { size: "LARGE", width: 7.5, depth: 6 };
}

interface ProjectRow {
  projects: UniverseProject[];
}

// Straight building, no center/pass-through room: every room on a floor sits in one row,
// side by side, all facing the same way (south) — no corridor between them anymore, just a
// thin reveal, so there's no reason a row is capped at 2 the way an actual hallway would be.
const ROW_SIZE = 3;

function chunkIntoRows(projects: UniverseProject[]): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (let i = 0; i < projects.length; i += ROW_SIZE) rows.push({ projects: projects.slice(i, i + ROW_SIZE) });
  return rows;
}

/** Every room on a floor sits in one row, side by side, each with its own front-facing
    opening (south) — every project room faces the same way, none opens toward another
    across a gap. Thin PROJECT_ROOM_GAP reveals separate adjacent rooms, nothing more. */
function placeRow(rooms: RoomLayout[], row: ProjectRow, z: number, y: number, floorIndex: number): number {
  const sizes = row.projects.map((p) => roomSizeFor(p.resourceCount));
  const rowDepth = Math.max(...sizes.map((s) => s.depth));
  const rowCenterZ = z + rowDepth / 2;
  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) + PROJECT_ROOM_GAP * (sizes.length - 1);

  let cursorX = -totalWidth / 2;
  row.projects.forEach((project, idx) => {
    const { size, width, depth } = sizes[idx];
    const roomX = cursorX + width / 2;
    cursorX += width + PROJECT_ROOM_GAP;
    const slot: "left" | "right" | "center" = idx === 0 ? "left" : idx === row.projects.length - 1 ? "right" : "center";
    rooms.push({
      id: project.id,
      kind: "project",
      projectId: project.id,
      name: project.name,
      accent: project.accent,
      size,
      x: roomX,
      y,
      z: rowCenterZ,
      width,
      depth,
      doorPoint: [roomX, rowCenterZ - depth / 2],
      side: slot,
      openSides: ["south"],
      resourceCount: project.resourceCount,
      floorIndex,
    });
  });

  return z + rowDepth + ROW_GAP;
}

/** 1F: Reception, then Command Center and Operations — the building's own staff floor.
    No projects and no Server Room here anymore; projects get their own floors above, the
    Server Room its own floor below (B1), directly under this one, not off to the side. */
function buildGroundFloor() {
  const rooms: RoomLayout[] = [];
  let z = 0;

  rooms.push({
    id: "reception",
    kind: "reception",
    name: "ID SYSTEM",
    accent: "#38bdf8",
    size: "SMALL",
    x: 0,
    y: 0,
    z: z + LANDING_DEPTH / 2,
    width: 4.5,
    depth: LANDING_DEPTH,
    doorPoint: [0, z + LANDING_DEPTH],
    side: "center",
    openSides: ["north"],
    resourceCount: 0,
    floorIndex: 0,
  });
  z += LANDING_DEPTH + ROW_GAP;

  const commandDepth = 4.5;
  rooms.push({
    id: "command-center",
    kind: "command-center",
    name: "COMMAND CENTER",
    accent: "#38bdf8",
    size: "MEDIUM",
    x: 0,
    y: 0,
    z: z + commandDepth / 2,
    width: 6.5,
    depth: commandDepth,
    doorPoint: [0, z],
    side: "center",
    openSides: ["north", "south"],
    resourceCount: 0,
    floorIndex: 0,
  });
  z += commandDepth + ROW_GAP;

  const opsDepth = 4;
  rooms.push({
    id: "operations",
    kind: "operations",
    name: "OPERATIONS",
    accent: "#8890a3",
    size: "MEDIUM",
    x: 0,
    y: 0,
    z: z + opsDepth / 2,
    width: 6,
    depth: opsDepth,
    doorPoint: [0, z],
    side: "center",
    openSides: ["north", "south"],
    resourceCount: 0,
    floorIndex: 0,
  });
  return { rooms };
}

/** B1: the Server Room, directly beneath 1F (same x, same landing-aligned z) — a real
    basement level, not a room laterally down the same hallway. */
function buildBasementFloor(providers: UniverseProviderSummary[]) {
  const providerCount = Math.max(providers.length, 1);
  const serverWidth = Math.max(6.5, providerCount * 2.6 + 2);
  const serverDepth = 5;
  const serverZ = serverDepth / 2;
  const rooms: RoomLayout[] = [
    {
      id: "server-room",
      kind: "server-room",
      name: "SERVER ROOM",
      accent: "#38bdf8",
      size: "LARGE",
      x: 0,
      y: -FLOOR_HEIGHT,
      z: serverZ,
      width: serverWidth,
      depth: serverDepth,
      doorPoint: [0, serverDepth],
      side: "center",
      openSides: ["north"],
      resourceCount: 0,
      floorIndex: -1,
    },
  ];

  const serverRacks = providers.map((provider, index) => {
    const slotWidth = serverWidth / providerCount;
    const rackX = -serverWidth / 2 + slotWidth * (index + 0.5);
    return { providerId: provider.id, name: provider.name, color: provider.color, x: rackX, z: serverZ };
  });

  return { rooms, serverRacks };
}

/**
 * A real multi-story building, architectural-cutaway style: B1 is the Server Room, 1F is
 * Reception/Command Center/Operations, and every row of up to 3 projects gets its own
 * floor stacked straight above, all sharing one fixed (x,z) vertical alignment point
 * (used only for cross-floor pathing, not rendered as any structure). Sorting projects by
 * id keeps floor assignment stable across refreshes for the same data.
 */
export function computeHqLayout(projects: UniverseProject[], providers: UniverseProviderSummary[]): HqLayout {
  const sortedProjects = [...projects].sort((a, b) => a.id.localeCompare(b.id));
  const rows = chunkIntoRows(sortedProjects);

  const rooms: RoomLayout[] = [];
  const corridors: CorridorFloor[] = [];
  const corridorWalls: CorridorWallSegment[] = [];
  const corridorDoors: CorridorDoor[] = [];
  const floorFootprints: FloorFootprint[] = [];

  function addFloor(floorRooms: RoomLayout[], floorIndex: number, y: number, label: string, corridorWidth: number, hasHallway: boolean) {
    rooms.push(...floorRooms);
    // Flush to the rooms themselves, never a shared nominal corridor length — a project
    // floor's rooms start well past z=0 (that leading stretch is the empty landing zone
    // shared by every floor so the vertical alignment point lines up), so sizing anything to
    // that nominal length left it overhanging past the walls on the empty end.
    const minX = Math.min(...floorRooms.map((r) => r.x - r.width / 2));
    const maxX = Math.max(...floorRooms.map((r) => r.x + r.width / 2));
    const minZ = Math.min(...floorRooms.map((r) => r.z - r.depth / 2));
    const maxZ = Math.max(...floorRooms.map((r) => r.z + r.depth / 2));
    corridors.push({ minZ, maxZ, width: corridorWidth, y, floorIndex, label });
    // Project floors have no hallway anymore — every room faces front with its own solid
    // perimeter otherwise, so there's no shared edge left needing a wall-with-a-door; adding
    // one would just double up on the room's own (already solid) side wall.
    if (hasHallway) {
      const { walls, doors } = computeCorridorWallsAndDoors(floorRooms, minZ, maxZ, corridorWidth, y);
      corridorWalls.push(...walls);
      corridorDoors.push(...doors);
    }
    floorFootprints.push({ floorIndex, y, minX, maxX, minZ, maxZ });
  }

  const basement = buildBasementFloor(providers);
  addFloor(basement.rooms, -1, -FLOOR_HEIGHT, "B1 — INFRASTRUCTURE", CORRIDOR_WIDTH, true);

  const ground = buildGroundFloor();
  addFloor(ground.rooms, 0, 0, "1F — OPERATIONS", CORRIDOR_WIDTH, true);

  rows.forEach((row, i) => {
    const floorIndex = i + 1;
    const y = floorIndex * FLOOR_HEIGHT;
    const floorRooms: RoomLayout[] = [];
    placeRow(floorRooms, row, LANDING_DEPTH + ROW_GAP, y, floorIndex);
    // Project floors use the tight PROJECT_ROOM_GAP, not the ground floor's real hallway
    // width — there's no walking corridor between the two rooms anymore, just a reveal.
    addFloor(floorRooms, floorIndex, y, `${floorIndex + 1}F — PROJECTS`, PROJECT_ROOM_GAP, false);
  });

  const floorCount = rows.length;
  const elevator = { x: 0, z: LANDING_DEPTH / 2, topY: floorCount * FLOOR_HEIGHT + WALL_HEIGHT + 0.6 };

  const bounds = computeWorldBounds(rooms);
  const center: [number, number, number] = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2];
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const halfDepth = (bounds.maxZ - bounds.minZ) / 2;
  const halfHeight = (bounds.maxY - bounds.minY) / 2;
  // Diagonal of the full 3D footprint, not just XZ — so a taller building (more floors)
  // pulls the overview camera back too, not only a wider or longer one.
  const radius = Math.max(Math.sqrt(halfWidth ** 2 + halfDepth ** 2 + halfHeight ** 2), 6) + 2.5;

  return { rooms, corridors, serverRacks: basement.serverRacks, corridorWalls, corridorDoors, elevator, floorFootprints, floorCount, floorHeight: FLOOR_HEIGHT, bounds, center, radius };
}

/** A room's walkable "door" and "inside" points, for the waypoint path builder. */
export function findRoom(layout: HqLayout, id: string): RoomLayout | undefined {
  return layout.rooms.find((r) => r.id === id);
}

/**
 * Builds a simple, wall-safe path between two rooms: door → along that floor's corridor
 * spine (x=0) → door. When the rooms are on different floors, the path detours through
 * the elevator core (same x,z on every floor) for the vertical leg — never cuts through a
 * wall or a floor slab, because every room's only opening faces its own floor's corridor.
 */
export function buildCorridorPath(layout: HqLayout, fromRoomId: string, toRoomId: string): [number, number, number][] {
  const from = findRoom(layout, fromRoomId);
  const to = findRoom(layout, toRoomId);
  if (!from || !to) return [];

  const fromDoor: [number, number, number] = [from.doorPoint[0], from.y, from.doorPoint[1]];
  const fromCorridor: [number, number, number] = [0, from.y, from.doorPoint[1]];
  const toCorridor: [number, number, number] = [0, to.y, to.doorPoint[1]];
  const toDoor: [number, number, number] = [to.doorPoint[0], to.y, to.doorPoint[1]];
  const toCenter: [number, number, number] = [to.x, to.y, to.z];

  if (from.floorIndex === to.floorIndex) {
    return [fromDoor, fromCorridor, toCorridor, toDoor, toCenter];
  }

  const { x: ex, z: ez } = layout.elevator;
  const fromElevator: [number, number, number] = [ex, from.y, ez];
  const toElevator: [number, number, number] = [ex, to.y, ez];
  return [fromDoor, fromCorridor, fromElevator, toElevator, toCorridor, toDoor, toCenter];
}

/**
 * World-space workstation positions for every resource across every project
 * room, keyed by resource id. Shared by the room renderer and the task-agent
 * path builder so both agree on exactly where a given resource's desk sits.
 */
export function computeWorkstationWorldPositions(
  rooms: RoomLayout[],
  resourcesByRoom: Map<string, { id: string }[]>,
): Map<string, [number, number, number]> {
  const result = new Map<string, [number, number, number]>();
  for (const room of rooms) {
    if (room.kind !== "project") continue;
    const resources = resourcesByRoom.get(room.id) ?? [];
    const localPositions = computeWorkstationLocalPositions(room, resources.length);
    resources.forEach((resource, index) => {
      const local = localPositions[index];
      if (!local) return;
      result.set(resource.id, [room.x + local[0], room.y, room.z + local[1]]);
    });
  }
  return result;
}

/** Grid of workstation positions local to a room's own center (0,0), leaving a margin near the walls. */
export function computeWorkstationLocalPositions(room: RoomLayout, count: number): [number, number][] {
  if (count === 0) return [];
  const usableWidth = room.width - 1.6;
  const usableDepth = room.depth - 2.2; // leaves more room near the door for walking through
  const columns = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / columns);

  const colSpacing = columns > 1 ? usableWidth / (columns - 1) : 0;
  const rowSpacing = rows > 1 ? usableDepth / (rows - 1) : 0;

  const positions: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = columns > 1 ? -usableWidth / 2 + col * colSpacing : 0;
    const localZ = rows > 1 ? -usableDepth / 2 + row * rowSpacing : 0;
    // Bias toward the back wall (away from the door), matching an office layout.
    positions.push([x, localZ - 0.4]);
  }
  return positions;
}
