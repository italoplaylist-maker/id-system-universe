import { ASSET_KEYS, type AssetKey } from "./asset-keys";

export interface AssetManifestEntry {
  /** Where the real GLB goes, relative to /public. Never fetched unless `enabled` is true. */
  path: string;
  /**
   * Flip this to true once the file actually exists at `path`. The registry
   * never probes the network to guess — an explicit flag is the only thing
   * that turns a fallback into a GLB, so there's never a surprise 404 storm
   * for a file that isn't there yet.
   */
  enabled: boolean;
  category: "office" | "people" | "infrastructure" | "decoration";
  label: string;
  scale: number;
  rotationY: number;
}

function entry(path: string, category: AssetManifestEntry["category"], label: string): AssetManifestEntry {
  return { path, category, label, enabled: false, scale: 1, rotationY: 0 };
}

/**
 * Drop the matching GLB at the given path (see ASSETS.md) and flip `enabled`
 * to true — nothing else in the 3D code needs to change. Every entry starts
 * disabled because none of these files ship with the repo yet (this sandbox
 * has no route to any CC0 model host to fetch and vet one — see ASSETS.md).
 */
export const ASSET_MANIFEST: Record<AssetKey, AssetManifestEntry> = {
  [ASSET_KEYS.OFFICE_DESK]: entry("/models/office/desk.glb", "office", "Desk"),
  [ASSET_KEYS.OFFICE_CHAIR]: entry("/models/office/chair.glb", "office", "Chair"),
  [ASSET_KEYS.MONITOR]: entry("/models/office/monitor.glb", "office", "Monitor"),
  [ASSET_KEYS.DUAL_MONITOR]: entry("/models/office/dual-monitor.glb", "office", "Dual Monitor"),
  [ASSET_KEYS.RECEPTION_DESK]: entry("/models/office/reception-desk.glb", "office", "Reception Desk"),
  [ASSET_KEYS.WALL_SCREEN]: entry("/models/office/wall-screen.glb", "office", "Wall Screen"),
  [ASSET_KEYS.SOFA]: entry("/models/decoration/sofa.glb", "decoration", "Sofa"),
  [ASSET_KEYS.PLANT]: entry("/models/decoration/plant.glb", "decoration", "Plant"),
  [ASSET_KEYS.CABINET]: entry("/models/decoration/cabinet.glb", "decoration", "Cabinet"),
  [ASSET_KEYS.SERVER_RACK]: entry("/models/infrastructure/server-rack.glb", "infrastructure", "Server Rack"),
  [ASSET_KEYS.SERVER_TOWER]: entry("/models/infrastructure/server.glb", "infrastructure", "Server Tower"),
  [ASSET_KEYS.EMPLOYEE_STANDARD]: entry("/models/people/employee-01.glb", "people", "Employee 01"),
  [ASSET_KEYS.EMPLOYEE_ALT]: entry("/models/people/employee-02.glb", "people", "Employee 02"),
};
