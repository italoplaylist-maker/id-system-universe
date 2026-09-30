import { NextResponse } from "next/server";
import { HQ_LOCATION } from "@/lib/hq-location";

export type WeatherCondition = "ENSOLARADO" | "PARCIALMENTE_NUBLADO" | "NUBLADO" | "CHUVA" | "CHUVA_FORTE";

export interface WeatherPayload {
  ok: true;
  temperature: number;
  condition: WeatherCondition;
  cloudCover: number;
  precipitation: number;
  windSpeed: number;
  humidity: number;
  sunrise: string | null;
  sunset: string | null;
}

interface CacheEntry {
  data: WeatherPayload;
  at: number;
}

// Module-level, shared across requests on this server instance — the point
// is never hitting the provider more than once per TTL regardless of how
// often clients poll this route.
let cache: CacheEntry | null = null;
const TTL_MS = 20 * 60 * 1000;

/** WMO weather codes (Open-Meteo's `weather_code`) collapsed into the coarse buckets the 3D world reacts to. */
function classify(code: number, cloudCover: number): WeatherCondition {
  if (code >= 95) return "CHUVA_FORTE";
  if (code >= 80 || (code >= 61 && code <= 67)) return code >= 65 || code === 82 ? "CHUVA_FORTE" : "CHUVA";
  if (code >= 51 && code <= 57) return "CHUVA";
  if (code >= 71 && code <= 77) return "CHUVA"; // snow — treated as the closest precipitation bucket this world has
  if (code === 0) return "ENSOLARADO";
  if (cloudCover >= 70 || code >= 45) return "NUBLADO";
  if (cloudCover >= 30 || (code >= 1 && code <= 3)) return "PARCIALMENTE_NUBLADO";
  return "ENSOLARADO";
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  try {
    const { latitude, longitude, timezone } = HQ_LOCATION;
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,weather_code");
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("timezone", timezone);

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`weather provider returned ${res.status}`);
    const json = await res.json();
    const current = json.current;
    if (!current) throw new Error("weather provider response missing current block");

    const payload: WeatherPayload = {
      ok: true,
      temperature: Math.round(current.temperature_2m),
      condition: classify(current.weather_code, current.cloud_cover),
      cloudCover: current.cloud_cover,
      precipitation: current.precipitation,
      windSpeed: current.wind_speed_10m,
      humidity: current.relative_humidity_2m,
      sunrise: json.daily?.sunrise?.[0] ?? null,
      sunset: json.daily?.sunset?.[0] ?? null,
    };
    cache = { data: payload, at: Date.now() };
    return NextResponse.json(payload);
  } catch {
    // Never let a flaky weather provider break the Universe — the caller falls back to
    // local time/astronomy alone and shows the weather chip as unavailable.
    return NextResponse.json({ ok: false });
  }
}
