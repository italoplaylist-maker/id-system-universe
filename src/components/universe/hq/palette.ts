/**
 * Single source of truth for the HQ's color language (briefing section 50).
 * A direction, not a law — but every new material should start here before
 * inventing a new hex value.
 */
export const PALETTE = {
  background: "#06090d",
  floor: "#151c24",
  floorAccentTrim: "#1c2530",
  corridor: "#1b2530",
  wall: "#2a3745",
  wallCap: "#3a4a5c",
  furniture: "#202a35",
  furnitureDark: "#171e26",
  metal: "#303c49",
  metalDark: "#232b34",
  fabric: "#39424e",
  screen: "#4cc9f0",
  glass: "#8fd8ff",
  skin: "#e3b98f",
  skinAlt: "#8a5a3c",
  uniform: "#3d4b5c",
  uniformAlt: "#4a3d5c",
} as const;

export const STATUS_COLOR = {
  RUNNING: "#34d399",
  STOPPED: "#4b5563",
  DEPLOYING: "#4cc9f0",
  ERROR: "#f87171",
  UNKNOWN: "#8890a3",
  WARNING: "#fbbf24",
} as const;
