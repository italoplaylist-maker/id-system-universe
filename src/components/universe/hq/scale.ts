/**
 * One human scale for the whole building (briefing 11/86) — every fallback
 * and, later, every imported GLB gets normalized against these, instead of
 * each component inventing its own numbers.
 */
export const SCALE = {
  EMPLOYEE_HEIGHT: 1.7,
  DOOR_HEIGHT: 2.2,
  DESK_HEIGHT: 0.75,
  CHAIR_HEIGHT: 0.85,
  WALL_HEIGHT: 2.5,
  RACK_HEIGHT: 2.0,
} as const;
