import * as THREE from "three";
import { getMoonPhase, getMoonPosition, getSunPosition, toDirection, type CelestialPosition } from "./astronomy";
import { HQ_LOCATION } from "@/lib/hq-location";

export type DayPhase = "madrugada" | "amanhecer" | "manha" | "meio-dia" | "tarde" | "por-do-sol" | "anoitecer" | "noite";

export interface EnvironmentState {
  now: Date;
  sun: CelestialPosition;
  sunDirection: [number, number, number];
  moon: CelestialPosition;
  moonDirection: [number, number, number];
  moonPhase: number;
  isDay: boolean;
  dayPhase: DayPhase;
  /** 0 at solar midnight-ish, 1 at full daylight — drives light intensity/sky blend. */
  daylightFactor: number;
}

const DEG = Math.PI / 180;

function classifyDayPhase(altitudeDeg: number, localHour: number): DayPhase {
  const morning = localHour < 12;
  if (altitudeDeg < -18) return morning ? "madrugada" : "noite";
  if (altitudeDeg < -6) return morning ? "amanhecer" : "anoitecer";
  if (altitudeDeg < 6) return morning ? "amanhecer" : "por-do-sol";
  if (altitudeDeg >= 55) return "meio-dia";
  return morning ? "manha" : "tarde";
}

/** Real time + real astronomy → one coherent environment snapshot, recomputed every so often (never per-frame). */
export function computeEnvironmentState(now: Date): EnvironmentState {
  const { latitude, longitude, timezone } = HQ_LOCATION;
  const sun = getSunPosition(now, latitude, longitude);
  const moon = getMoonPosition(now, latitude, longitude);
  const altitudeDeg = sun.altitude / DEG;

  let localHour = now.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour")?.value;
    if (hourPart) localHour = Number(hourPart) % 24;
  } catch {
    // Intl/timezone lookup failed (unsupported env) — fall back to local machine hour rather than crash.
  }

  const daylightFactor = THREE.MathUtils.clamp((altitudeDeg + 6) / 24, 0, 1);

  return {
    now,
    sun,
    sunDirection: toDirection(sun),
    moon,
    moonDirection: toDirection(moon),
    moonPhase: getMoonPhase(now),
    isDay: sun.altitude > 0,
    dayPhase: classifyDayPhase(altitudeDeg, localHour),
    daylightFactor,
  };
}

export const DAY_PHASE_LABEL: Record<DayPhase, string> = {
  madrugada: "Madrugada",
  amanhecer: "Amanhecer",
  manha: "Manhã",
  "meio-dia": "Meio-dia",
  tarde: "Tarde",
  "por-do-sol": "Pôr do sol",
  anoitecer: "Anoitecer",
  noite: "Noite",
};
