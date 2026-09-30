"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { WeatherPayload } from "@/app/api/environment/weather/route";

type WeatherResponse = WeatherPayload | { ok: false };

/** Real weather, cached ~20min server-side already — polled infrequently here too. Never breaks the Universe if the provider is down (see the route's own fallback). */
export function useWeather() {
  return useQuery({
    queryKey: ["environment", "weather"],
    queryFn: () => apiFetch<WeatherResponse>("/api/environment/weather"),
    refetchInterval: 20 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}
