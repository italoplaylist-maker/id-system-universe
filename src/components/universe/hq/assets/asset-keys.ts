/**
 * Every visual asset the HQ can place, by name. A key here is a contract:
 * the rest of the 3D code asks for "OFFICE_CHAIR", never for a file path or
 * a specific mesh — swapping the procedural fallback for a real GLB later
 * (see ASSETS.md) touches only asset-registry.tsx.
 */
export const ASSET_KEYS = {
  OFFICE_DESK: "OFFICE_DESK",
  OFFICE_CHAIR: "OFFICE_CHAIR",
  MONITOR: "MONITOR",
  DUAL_MONITOR: "DUAL_MONITOR",
  SERVER_TOWER: "SERVER_TOWER",
  RECEPTION_DESK: "RECEPTION_DESK",
  SOFA: "SOFA",
  PLANT: "PLANT",
  CABINET: "CABINET",
  SERVER_RACK: "SERVER_RACK",
  WALL_SCREEN: "WALL_SCREEN",
  EMPLOYEE_STANDARD: "EMPLOYEE_STANDARD",
  EMPLOYEE_ALT: "EMPLOYEE_ALT",
} as const;

export type AssetKey = (typeof ASSET_KEYS)[keyof typeof ASSET_KEYS];
