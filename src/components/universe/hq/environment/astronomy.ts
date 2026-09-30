/**
 * Compact solar/lunar position math (standard public astronomical formulas —
 * mean anomaly → ecliptic longitude → equatorial coordinates → horizontal
 * coordinates). Accurate to roughly a degree, which is all a lighting
 * direction needs — not a science-grade ephemeris.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;

function toJulian(date: Date): number {
  return date.getTime() / DAY_MS - 0.5 + J1970;
}

function toDays(date: Date): number {
  return toJulian(date) - J2000;
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

const OBLIQUITY = RAD * 23.4397;

function sunEquatorial(d: number): { ra: number; dec: number } {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return {
    dec: Math.asin(Math.sin(OBLIQUITY) * Math.sin(L)),
    ra: Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L)),
  };
}

function siderealTime(d: number, lw: number): number {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

/** Horizontal coordinates (azimuth from south, clockwise; altitude above horizon), radians. */
function horizontalCoords(H: number, phi: number, dec: number): { azimuth: number; altitude: number } {
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth, altitude };
}

export interface CelestialPosition {
  /** Radians, 0 = south, increasing clockwise (west). */
  azimuth: number;
  /** Radians above (positive) or below (negative) the horizon. */
  altitude: number;
}

export function getSunPosition(date: Date, latitude: number, longitude: number): CelestialPosition {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const d = toDays(date);
  const eq = sunEquatorial(d);
  const H = siderealTime(d, lw) - eq.ra;
  return horizontalCoords(H, phi, eq.dec);
}

function moonEquatorial(d: number): { ra: number; dec: number } {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)),
  };
}

export function getMoonPosition(date: Date, latitude: number, longitude: number): CelestialPosition {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const d = toDays(date);
  const eq = moonEquatorial(d);
  const H = siderealTime(d, lw) - eq.ra;
  return horizontalCoords(H, phi, eq.dec);
}

/** 0 = new moon, 0.5 = full moon, 1 = new moon again — rough synodic-month approximation. */
export function getMoonPhase(date: Date): number {
  const synodicMonth = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const daysSince = (date.getTime() - knownNewMoon) / DAY_MS;
  const phase = (daysSince % synodicMonth) / synodicMonth;
  return phase < 0 ? phase + 1 : phase;
}

/** Azimuth (from south, clockwise) + altitude → a unit direction in a Y-up world. */
export function toDirection(position: CelestialPosition): [number, number, number] {
  const x = Math.cos(position.altitude) * Math.sin(position.azimuth);
  const z = -Math.cos(position.altitude) * Math.cos(position.azimuth);
  const y = Math.sin(position.altitude);
  return [x, y, z];
}
