import type { UniverseApplication, UniverseProviderSummary } from "@/types/domain";

export interface StationLayout {
  applicationId: string;
  x: number;
  z: number;
}

export interface ClusterLayout {
  providerId: string;
  x: number;
  z: number;
  radius: number;
  stations: StationLayout[];
}

const CLUSTER_GAP = 9;
const STATION_BASE_RADIUS = 2.4;
const STATION_RADIUS_PER_APP = 0.55;

/**
 * Deterministic, overlap-free layout: clusters (providers) laid out along a
 * line whose spacing grows with each cluster's own footprint, applications
 * arranged in a ring inside their cluster whose radius grows with count.
 * No manual positioning, and it degrades gracefully from 1 to dozens of
 * providers/applications (see spec: "3 providers, 30 aplicações" must stay usable).
 */
export function computeUniverseLayout(providers: UniverseProviderSummary[], applications: UniverseApplication[]): ClusterLayout[] {
  const appsByProvider = new Map<string, UniverseApplication[]>();
  for (const app of applications) {
    const list = appsByProvider.get(app.providerId) ?? [];
    list.push(app);
    appsByProvider.set(app.providerId, list);
  }

  let cursorX = 0;
  const clusters: ClusterLayout[] = [];

  for (const provider of providers) {
    const apps = appsByProvider.get(provider.id) ?? [];
    const radius = STATION_BASE_RADIUS + Math.sqrt(apps.length) * STATION_RADIUS_PER_APP;

    const clusterX = cursorX + radius;
    const stations: StationLayout[] = apps.map((app, index) => {
      const angle = (index / Math.max(apps.length, 1)) * Math.PI * 2;
      return {
        applicationId: app.id,
        x: clusterX + Math.cos(angle) * radius * 0.62,
        z: Math.sin(angle) * radius * 0.62,
      };
    });

    clusters.push({ providerId: provider.id, x: clusterX, z: 0, radius, stations });
    cursorX = clusterX + radius + CLUSTER_GAP;
  }

  // Center the whole layout around the origin so the camera target stays fixed
  // regardless of how many clusters exist.
  const totalWidth = cursorX - CLUSTER_GAP;
  const offset = totalWidth / 2;
  return clusters.map((cluster) => ({
    ...cluster,
    x: cluster.x - offset,
    stations: cluster.stations.map((s) => ({ ...s, x: s.x - offset })),
  }));
}
