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
  /** Footprint center, on the XZ ground plane. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Point on the room's corridor-facing edge — the only "opening" in its walls. */
  doorPoint: [number, number];
  side: "left" | "right" | "center";
  /** Walls are skipped on these sides — the room's only openings. */
  openSides: OpenSide[];
  resourceCount: number;
}

export interface CorridorLayout {
  /** The shared walking spine: x is always 0, z runs from 0 to length. */
  length: number;
  width: number;
}

export interface HqLayout {
  rooms: RoomLayout[];
  corridor: CorridorLayout;
  serverRacks: { providerId: string; name: string; color: string; x: number; z: number }[];
  /** Bounding radius, used to size the camera and ground plane. */
  radius: number;
}

const CORRIDOR_WIDTH = 2.6;
const ROOM_GAP = 1.1;
const ROW_GAP = 1.5;

function roomSizeFor(resourceCount: number): { size: RoomSize; width: number; depth: number } {
  if (resourceCount <= 3) return { size: "SMALL", width: 5, depth: 4.5 };
  if (resourceCount <= 6) return { size: "MEDIUM", width: 6, depth: 5 };
  return { size: "LARGE", width: 7.5, depth: 6 };
}

interface ProjectRow {
  projects: UniverseProject[];
}

function chunkIntoRows(projects: UniverseProject[]): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (let i = 0; i < projects.length; i += 2) rows.push({ projects: projects.slice(i, i + 2) });
  return rows;
}

function placeRow(rooms: RoomLayout[], row: ProjectRow, z: number): number {
  const rowSizes = row.projects.map((p) => roomSizeFor(p.resourceCount));
  const rowDepth = Math.max(...rowSizes.map((s) => s.depth));
  const rowCenterZ = z + rowDepth / 2;

  row.projects.forEach((project, idx) => {
    const side: "left" | "right" = idx === 0 ? "left" : "right";
    const { size, width, depth } = rowSizes[idx];
    const roomX = (side === "left" ? -1 : 1) * (CORRIDOR_WIDTH / 2 + ROOM_GAP + width / 2);
    rooms.push({
      id: project.id,
      kind: "project",
      projectId: project.id,
      name: project.name,
      accent: project.accent,
      size,
      x: roomX,
      z: rowCenterZ,
      width,
      depth,
      doorPoint: [(side === "left" ? -1 : 1) * (CORRIDOR_WIDTH / 2), rowCenterZ],
      side,
      openSides: [side === "left" ? "east" : "west"],
      resourceCount: project.resourceCount,
    });
  });

  return z + rowDepth + ROW_GAP;
}

/**
 * Compact office floor plan: Reception at the entrance, then Project Rooms
 * in pairs either side of a central corridor — half the rows before Command
 * Center and half after, so Command Center sits at the geometric middle of
 * the project cluster (briefing: sandwich composition, not one long
 * corridor with everything strung along a single axis) — then Operations
 * and the Server Room at the far end. Sorting by id keeps the layout stable
 * across refreshes for the same data.
 */
export function computeHqLayout(projects: UniverseProject[], providers: UniverseProviderSummary[]): HqLayout {
  const rooms: RoomLayout[] = [];
  const sortedProjects = [...projects].sort((a, b) => a.id.localeCompare(b.id));
  const rows = chunkIntoRows(sortedProjects);
  const splitIndex = Math.ceil(rows.length / 2);
  const rowsBefore = rows.slice(0, splitIndex);
  const rowsAfter = rows.slice(splitIndex);

  let z = 0;

  // Reception
  const receptionDepth = 3;
  rooms.push({
    id: "reception",
    kind: "reception",
    name: "ID SYSTEM",
    accent: "#38bdf8",
    size: "SMALL",
    x: 0,
    z: z + receptionDepth / 2,
    width: 4.5,
    depth: receptionDepth,
    doorPoint: [0, z + receptionDepth],
    side: "center",
    openSides: ["north"],
    resourceCount: 0,
  });
  z += receptionDepth + ROW_GAP;

  for (const row of rowsBefore) z = placeRow(rooms, row, z);

  // Command Center — the hub of the composition, sized generously regardless of project count.
  const commandDepth = 4.5;
  rooms.push({
    id: "command-center",
    kind: "command-center",
    name: "COMMAND CENTER",
    accent: "#38bdf8",
    size: "MEDIUM",
    x: 0,
    z: z + commandDepth / 2,
    width: 6.5,
    depth: commandDepth,
    doorPoint: [0, z],
    side: "center",
    openSides: ["north", "south"],
    resourceCount: 0,
  });
  z += commandDepth + ROW_GAP;

  for (const row of rowsAfter) z = placeRow(rooms, row, z);

  // Operations
  const opsDepth = 4;
  rooms.push({
    id: "operations",
    kind: "operations",
    name: "OPERATIONS",
    accent: "#8890a3",
    size: "MEDIUM",
    x: 0,
    z: z + opsDepth / 2,
    width: 6,
    depth: opsDepth,
    doorPoint: [0, z],
    side: "center",
    openSides: ["north", "south"],
    resourceCount: 0,
  });
  z += opsDepth + ROW_GAP;

  // Server Room — width grows with provider count so racks never overlap.
  const providerCount = Math.max(providers.length, 1);
  const serverWidth = Math.max(6.5, providerCount * 2.6 + 2);
  const serverDepth = 5;
  const serverZ = z + serverDepth / 2;
  rooms.push({
    id: "server-room",
    kind: "server-room",
    name: "SERVER ROOM",
    accent: "#38bdf8",
    size: "LARGE",
    x: 0,
    z: serverZ,
    width: serverWidth,
    depth: serverDepth,
    doorPoint: [0, z],
    side: "center",
    openSides: ["south"],
    resourceCount: 0,
  });

  const serverRacks = providers.map((provider, index) => {
    const slotWidth = serverWidth / providerCount;
    const rackX = -serverWidth / 2 + slotWidth * (index + 0.5);
    return { providerId: provider.id, name: provider.name, color: provider.color, x: rackX, z: serverZ };
  });

  z += serverDepth;

  const radius = Math.max(z / 2, 7) + 3.5;

  return { rooms, corridor: { length: z, width: CORRIDOR_WIDTH }, serverRacks, radius };
}

/** A room's walkable "door" and "inside" points, for the waypoint path builder. */
export function findRoom(layout: HqLayout, id: string): RoomLayout | undefined {
  return layout.rooms.find((r) => r.id === id);
}

/**
 * Builds a simple, wall-safe path between two rooms: door → along the
 * corridor spine (x=0) → door. No navmesh, but it never cuts through a wall
 * because every room's only opening faces the shared corridor line.
 */
export function buildCorridorPath(layout: HqLayout, fromRoomId: string, toRoomId: string): [number, number][] {
  const from = findRoom(layout, fromRoomId);
  const to = findRoom(layout, toRoomId);
  if (!from || !to) return [];

  const fromCorridorPoint: [number, number] = [0, from.doorPoint[1]];
  const toCorridorPoint: [number, number] = [0, to.doorPoint[1]];

  return [from.doorPoint, fromCorridorPoint, toCorridorPoint, to.doorPoint, [to.x, to.z]];
}

/**
 * World-space workstation positions for every resource across every project
 * room, keyed by resource id. Shared by the room renderer and the task-agent
 * path builder so both agree on exactly where a given resource's desk sits.
 */
export function computeWorkstationWorldPositions(
  rooms: RoomLayout[],
  resourcesByRoom: Map<string, { id: string }[]>,
): Map<string, [number, number]> {
  const result = new Map<string, [number, number]>();
  for (const room of rooms) {
    if (room.kind !== "project") continue;
    const resources = resourcesByRoom.get(room.id) ?? [];
    const localPositions = computeWorkstationLocalPositions(room, resources.length);
    resources.forEach((resource, index) => {
      const local = localPositions[index];
      if (!local) return;
      result.set(resource.id, [room.x + local[0], room.z + local[1]]);
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
