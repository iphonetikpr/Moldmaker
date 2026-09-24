/** Locked CAD defaults (mm / degrees). Editable in the UI; these are the starting values. */

export const DEFAULTS = {
  wallThickness: 3.0,
  draftDeg: 1.5,
  siliconeGap: 0.5,
  funnelDiameter: 12,
  channelW: 4,
  channelH: 4,
  pinDiameter: 3.0,
  holeDiameter: 3.25,
  pinReach: 5,
  splitMax: 250,
  splitOverlap: 2.5,
  splitEnabled: false,
  clampSlot: 8,
  clampClearance: 0.3,
  clampEnabled: true,
  castShrinkPct: 0,
  /** Fraction of master height for the 2-part cut. 0.5 = Z mid. */
  cutRatio: 0.5,
} as const;

/** Floor keys on Adapted Box (not a user-facing locked default). */
export const KEY_SIZE = 6;
export const KEY_HEIGHT = 2;
export const KEY_INSET = 4;

/** Perimeter tongue on 2-part molds. Groove grows by clampClearance. */
export const SEAL_W = 1.6;
export const SEAL_H = 1.2;

export const THEME_KEY = "moldmaker.theme";

export const CYL_SEGMENTS = 48;
