/**
 * Single source of truth for the HQ's real-world location — every place that
 * needs latitude/longitude/timezone (sun/moon position, weather, the clock)
 * reads from here instead of hardcoding coordinates of its own.
 */
export const HQ_LOCATION = {
  name: "São Paulo, BR",
  latitude: -23.5505,
  longitude: -46.6333,
  timezone: "America/Sao_Paulo",
} as const;
